import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  actionItems,
  actionPlans,
  auditLog,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  rcaNotes,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "@/lib/db/schema";
import {
  canAutoReplay,
  evaluateWeeklyResult,
  replayEmployeeKpiHistory,
  shouldAgeOut,
} from "./engine";
import {
  DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
  type IssueStatus,
  type PerformanceIssueState,
} from "./types";

/** Statuses that mean the issue is still live, so a new one must not be opened alongside it. */
const ACTIVE_STATUSES: IssueStatus[] = [
  "OPEN",
  "AWAITING_AGENT_ACKNOWLEDGEMENT",
  "ACKNOWLEDGED",
  "MONITORING",
  "SUSTAINED",
  "REOPENED",
];

export interface EngineRunResult {
  opened: number;
  updated: number;
  completed: number;
  /** Long-running issues closed on age because their KPI had recovered. */
  agedOut: number;
  /** Issues whose already-folded history no longer matched current data and were safely rebuilt. */
  corrected: number;
  /** Same situation, but left untouched for a person to review — see canAutoReplay. */
  flagged: number;
}

interface LiveIssue {
  id: string;
  employeeId: string;
  kpiId: string;
  state: PerformanceIssueState;
  lastEvaluatedWeek: string | null;
}

/**
 * Folds weekly metric results into performance issues.
 *
 * All decision logic lives in the pure engine (engine.ts); this module only
 * loads state, applies the engine's verdict, and writes the result.
 *
 * Weeks are processed oldest-first because the 4-week rule is order
 * dependent, but within a week every issue is resolved in memory and
 * written back in bulk — a per-row round trip to a pooled remote database
 * makes a full import take many minutes.
 */
export async function runIssueEngineForWeeks(weeks: string[]): Promise<EngineRunResult> {
  const result: EngineRunResult = {
    opened: 0,
    updated: 0,
    completed: 0,
    agedOut: 0,
    corrected: 0,
    flagged: 0,
  };
  if (weeks.length === 0) return result;

  const live = await loadLiveIssues();
  // One bulk read, not one per already-evaluated row: a routine re-import of
  // weeks that are mostly unchanged (the normal case for a large historical
  // file that also happens to re-cover a few recent weeks) would otherwise
  // turn every single one of those rows into its own round trip just to
  // confirm nothing changed.
  const historyByIssueWeek = await loadHistoryByIssue([...live.values()].map((i) => i.id));
  const staleTouches: Array<{ employeeId: string; kpiId: string }> = [];

  for (const week of [...new Set(weeks)].sort()) {
    // Component KPIs (the PAR rating, DPU, DPO) are gates on the composite
    // MBO result rather than standalone measures, so they are shown on the
    // scorecard but never open an action item of their own.
    const metrics = await db
      .select({
        employeeId: weeklyMetricResults.employeeId,
        kpiId: weeklyMetricResults.kpiId,
        status: weeklyMetricResults.status,
      })
      .from(weeklyMetricResults)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
      .where(
        and(
          eq(weeklyMetricResults.weekStart, week),
          eq(kpiDefinitions.generatesActionItems, true),
        ),
      )
      .orderBy(asc(weeklyMetricResults.employeeId));

    const updates: Array<{ issue: LiveIssue; next: PerformanceIssueState }> = [];
    const opens: Array<{ employeeId: string; kpiId: string; state: PerformanceIssueState }> = [];
    const history: Array<typeof weeklyIssueHistory.$inferInsert> = [];
    const events: Array<typeof auditLog.$inferInsert> = [];

    for (const metric of metrics) {
      const key = `${metric.employeeId}|${metric.kpiId}`;
      const existing = live.get(key);

      // WARNING sits above the failure threshold, so it counts as a pass.
      const weekResult = metric.status === "fail" ? "FAIL" : "PASS";

      // Already folded in: re-importing the same or an earlier week is
      // normally a no-op — checked here against the already-loaded history
      // map, not a query, since this is the common case for a routine
      // re-import. Only a genuine mismatch (the week's own data changed
      // since it was folded in — a ramp target correction, a routing fix)
      // is queued for the more expensive reconciliation below.
      if (existing?.lastEvaluatedWeek && existing.lastEvaluatedWeek >= week) {
        const storedResult = historyByIssueWeek.get(`${existing.id}|${week}`);
        const currentResult = weekResult === "FAIL" ? "fail" : "pass";
        if (storedResult !== currentResult) {
          staleTouches.push({ employeeId: metric.employeeId, kpiId: metric.kpiId });
        }
        continue;
      }

      const outcome = evaluateWeeklyResult(
        existing?.state ?? null,
        weekResult,
        week,
        DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
      );
      if (!outcome.issue) continue;

      if (!existing) {
        if (weekResult !== "FAIL") continue;
        opens.push({ employeeId: metric.employeeId, kpiId: metric.kpiId, state: outcome.issue });
        continue;
      }

      existing.state = outcome.issue;
      existing.lastEvaluatedWeek = week;
      updates.push({ issue: existing, next: outcome.issue });
      history.push({
        performanceIssueId: existing.id,
        week,
        result: weekResult === "FAIL" ? "fail" : "pass",
        consecutiveCountAfter: outcome.issue.consecutivePassingWeeks,
      });

      for (const event of outcome.events) {
        if (
          event.type === "ISSUE_REOPENED" ||
          event.type === "ISSUE_SUSTAINED" ||
          event.type === "ISSUE_COMPLETED"
        ) {
          events.push({
            action: `issue.${event.type.toLowerCase()}`,
            entityType: "performance_issue",
            entityId: existing.id,
            after: { week, status: outcome.issue.status },
          });
        }
      }

      if (outcome.issue.status === "COMPLETED") {
        result.completed += 1;
        // A completed issue is no longer live; a later failure opens a fresh one.
        live.delete(key);
      }
      result.updated += 1;
    }

    await applyUpdates(updates);
    const opened = await applyOpens(opens, week, live);
    result.opened += opened;

    await insertHistory(history);
    await insertEvents(events);
  }

  if (staleTouches.length > 0) {
    const { corrected, flagged } = await reconcileStaleTouches(staleTouches, live);
    result.corrected += corrected;
    result.flagged += flagged;
  }

  // Last, so it sees the statuses this run has just written rather than the
  // ones it started with.
  result.agedOut = await ageOutRecoveredIssues(live);

  return result;
}

/**
 * Closes issues that have outlived the threshold and whose KPI has recovered.
 *
 * The four-passing-weeks rule needs weeks to keep arriving for that employee
 * and KPI; an agent who recovered and then moved queue or stopped being
 * measured leaves an issue open indefinitely. This is the other way out.
 *
 * Deliberately never touches an issue whose latest result is a failure, or one
 * with no result at all — see shouldAgeOut. The point is to clear items that
 * are done, not to make a long queue look shorter.
 */
/**
 * Runs the age-out rule over the whole live backlog, outside an import.
 *
 * The rule normally rides along with an engine run, which only happens when
 * weeks are imported or replayed. This applies it to the items already
 * sitting there.
 */
export async function ageOutStaleIssues(dryRun = false): Promise<number> {
  return ageOutRecoveredIssues(await loadLiveIssues(), dryRun);
}

async function ageOutRecoveredIssues(
  live: Map<string, LiveIssue>,
  /** Report only; nothing is written. */
  dryRun = false,
): Promise<number> {
  if (live.size === 0) return 0;

  // Reporting time, not wall-clock: a database imported late must not age
  // every open item out at once.
  const [asOf] = await db
    .select({ week: sql<string | null>`max(${weeklyMetricResults.weekEnd})::text` })
    .from(weeklyMetricResults);
  if (!asOf?.week) return 0;
  const asOfWeek = asOf.week;

  const issues = [...live.values()];
  const latest = await db
    .select({
      employeeId: weeklyMetricResults.employeeId,
      kpiId: weeklyMetricResults.kpiId,
      status: weeklyMetricResults.status,
      week: weeklyMetricResults.weekStart,
    })
    .from(weeklyMetricResults)
    .where(
      inArray(
        weeklyMetricResults.employeeId,
        [...new Set(issues.map((i) => i.employeeId))],
      ),
    )
    .orderBy(asc(weeklyMetricResults.weekStart));

  // Last write wins, and the rows arrive oldest first, so this ends up
  // holding each pair's most recent result.
  const lastByPair = new Map<string, "pass" | "warning" | "fail">();
  for (const row of latest) {
    lastByPair.set(`${row.employeeId}|${row.kpiId}`, row.status);
  }

  const closing = issues.filter((issue) =>
    shouldAgeOut(
      {
        status: issue.state.status,
        openedWeek: issue.state.openedWeek,
        latestResult: lastByPair.get(`${issue.employeeId}|${issue.kpiId}`) ?? null,
      },
      asOfWeek,
    ),
  );
  if (closing.length === 0) return 0;

  if (dryRun) return closing.length;

  const ids = closing.map((i) => i.id);
  await db.transaction(async (tx) => {
    await tx
      .update(performanceIssues)
      .set({ status: "COMPLETED", resolvedWeek: asOfWeek, updatedAt: sql`now()` })
      .where(inArray(performanceIssues.id, ids));
    await tx
      .update(actionItems)
      .set({ status: "COMPLETED", updatedAt: sql`now()` })
      .where(inArray(actionItems.performanceIssueId, ids));
    // Recorded under its own action, so a closure on age is never mistaken
    // for one earned through four passing weeks.
    await tx.insert(auditLog).values(
      closing.map((issue) => ({
        action: "issue.aged_out",
        entityType: "performance_issue",
        entityId: issue.id,
        before: { status: issue.state.status, openedWeek: issue.state.openedWeek },
        after: { status: "COMPLETED", resolvedWeek: asOfWeek, reason: "recovered and past age threshold" },
      })),
    );
  });

  for (const issue of closing) live.delete(`${issue.employeeId}|${issue.kpiId}`);
  return closing.length;
}

/**
 * Rebuilds (or flags) an issue whose already-folded weekly history no
 * longer matches current data.
 *
 * One employee+KPI can appear multiple times in `touches` (several weeks
 * in one import batch can all be stale); each pair is reconciled once,
 * against the *entire* weekly ledger for that KPI rather than just the
 * weeks that triggered it, since a stale opened-week can only be found by
 * looking at the whole trajectory.
 */
async function reconcileStaleTouches(
  touches: Array<{ employeeId: string; kpiId: string }>,
  live: Map<string, LiveIssue>,
): Promise<{ corrected: number; flagged: number }> {
  const pairs = new Map(touches.map((t) => [`${t.employeeId}|${t.kpiId}`, t]));

  let corrected = 0;
  let flagged = 0;

  for (const { employeeId, kpiId } of pairs.values()) {
    const issue = live.get(`${employeeId}|${kpiId}`);
    if (!issue) continue; // stale touches only ever come from an existing live issue

    const [allMetrics, storedHistory, otherIssues] = await Promise.all([
      db
        .select({ week: weeklyMetricResults.weekStart, status: weeklyMetricResults.status })
        .from(weeklyMetricResults)
        .where(and(eq(weeklyMetricResults.employeeId, employeeId), eq(weeklyMetricResults.kpiId, kpiId)))
        .orderBy(asc(weeklyMetricResults.weekStart)),
      db.select().from(weeklyIssueHistory).where(eq(weeklyIssueHistory.performanceIssueId, issue.id)),
      db
        .select({ id: performanceIssues.id })
        .from(performanceIssues)
        .where(and(eq(performanceIssues.employeeId, employeeId), eq(performanceIssues.kpiId, kpiId))),
    ]);

    const replay = replayEmployeeKpiHistory(allMetrics);

    const storedByWeek = new Map(storedHistory.map((h) => [h.week, h.result]));
    const replayByWeek = new Map(replay.history.map((h) => [h.week, h.result]));
    const touchedWeeks = new Set([...storedByWeek.keys(), ...replayByWeek.keys()]);
    const isStale = [...touchedWeeks].some((w) => storedByWeek.get(w) !== replayByWeek.get(w));
    if (!isStale) continue;

    const [actionItemRow] = await db
      .select()
      .from(actionItems)
      .where(eq(actionItems.performanceIssueId, issue.id))
      .limit(1);
    if (!actionItemRow) continue; // every issue has one; defensive only

    const [[rcaRow], [planRow], noteRows] = await Promise.all([
      db.select({ id: rcaEntries.id }).from(rcaEntries).where(eq(rcaEntries.actionItemId, actionItemRow.id)).limit(1),
      db.select({ id: actionPlans.id }).from(actionPlans).where(eq(actionPlans.actionItemId, actionItemRow.id)).limit(1),
      db.select({ id: rcaNotes.id }).from(rcaNotes).where(eq(rcaNotes.actionItemId, actionItemRow.id)).limit(1),
    ]);

    const eligible = canAutoReplay({
      status: issue.state.status,
      hasRca: !!rcaRow,
      hasActionPlan: !!planRow,
      hasNotes: noteRows.length > 0,
      hasOtherIssuesForKpi: otherIssues.length > 1,
    });

    const before = {
      status: issue.state.status,
      openedWeek: issue.state.openedWeek,
      consecutivePassingWeeks: issue.state.consecutivePassingWeeks,
      history: Object.fromEntries(storedByWeek),
    };

    if (!eligible) {
      await db.insert(auditLog).values({
        action: "issue.stale_data_flagged",
        entityType: "performance_issue",
        entityId: issue.id,
        before,
        after: { current: Object.fromEntries(replayByWeek) },
      });
      flagged += 1;
      continue;
    }

    const lastWeek = allMetrics.at(-1)?.week ?? issue.lastEvaluatedWeek;

    if (!replay.issue) {
      // Corrected data never fails at all — this issue should never have opened.
      await db.delete(actionItems).where(eq(actionItems.id, actionItemRow.id));
      await db.delete(weeklyIssueHistory).where(eq(weeklyIssueHistory.performanceIssueId, issue.id));
      await db.delete(performanceIssues).where(eq(performanceIssues.id, issue.id));
      live.delete(`${employeeId}|${kpiId}`);
    } else {
      await db
        .update(performanceIssues)
        .set({
          status: replay.issue.status,
          openedWeek: replay.issue.openedWeek,
          consecutivePassingWeeks: replay.issue.consecutivePassingWeeks,
          resolvedWeek: replay.issue.resolvedWeek ?? null,
          lastEvaluatedWeek: lastWeek,
          updatedAt: sql`now()`,
        })
        .where(eq(performanceIssues.id, issue.id));
      await db
        .update(actionItems)
        .set({ status: replay.issue.status, updatedAt: sql`now()` })
        .where(eq(actionItems.id, actionItemRow.id));
      await db.delete(weeklyIssueHistory).where(eq(weeklyIssueHistory.performanceIssueId, issue.id));
      if (replay.history.length > 0) {
        await db.insert(weeklyIssueHistory).values(
          replay.history.map((h) => ({
            performanceIssueId: issue.id,
            week: h.week,
            result: h.result,
            consecutiveCountAfter: h.consecutiveCountAfter,
          })),
        );
      }
      issue.state = replay.issue;
      issue.lastEvaluatedWeek = lastWeek;
    }

    await db.insert(auditLog).values({
      action: "issue.stale_data_corrected",
      entityType: "performance_issue",
      entityId: issue.id,
      before,
      after: replay.issue
        ? { ...replay.issue, history: Object.fromEntries(replayByWeek) }
        : { deleted: true },
    });
    corrected += 1;
  }

  return { corrected, flagged };
}

/** Every recorded week's result for the given issues, keyed by `${issueId}|${week}`. */
async function loadHistoryByIssue(issueIds: string[]): Promise<Map<string, "pass" | "fail">> {
  if (issueIds.length === 0) return new Map();

  const rows = await db
    .select({ performanceIssueId: weeklyIssueHistory.performanceIssueId, week: weeklyIssueHistory.week, result: weeklyIssueHistory.result })
    .from(weeklyIssueHistory)
    .where(inArray(weeklyIssueHistory.performanceIssueId, issueIds));

  return new Map(rows.map((r) => [`${r.performanceIssueId}|${r.week}`, r.result]));
}

async function loadLiveIssues(): Promise<Map<string, LiveIssue>> {
  const rows = await db
    .select()
    .from(performanceIssues)
    .where(inArray(performanceIssues.status, ACTIVE_STATUSES));

  return new Map(
    rows.map((row) => [
      `${row.employeeId}|${row.kpiId}`,
      {
        id: row.id,
        employeeId: row.employeeId,
        kpiId: row.kpiId,
        lastEvaluatedWeek: row.lastEvaluatedWeek,
        state: {
          status: row.status,
          consecutivePassingWeeks: row.consecutivePassingWeeks,
          openedWeek: row.openedWeek,
          resolvedWeek: row.resolvedWeek ?? undefined,
        },
      },
    ]),
  );
}

/**
 * Writes every changed issue in one statement using a VALUES join, rather
 * than one UPDATE per issue.
 *
 * The two tables are always meant to carry the same status — each chunk's
 * pair of statements runs in one transaction so a dropped connection or a
 * timeout between them can never leave one updated and the other not, with
 * nothing else in the app positioned to notice or repair that gap later.
 */
async function applyUpdates(updates: Array<{ issue: LiveIssue; next: PerformanceIssueState }>) {
  if (updates.length === 0) return;

  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);

    const values = sql.join(
      slice.map(
        ({ issue, next }) =>
          sql`(${issue.id}::uuid, ${next.status}::issue_status, ${next.consecutivePassingWeeks}::integer, ${
            next.resolvedWeek ?? null
          }::date, ${issue.lastEvaluatedWeek}::date)`,
      ),
      sql`, `,
    );

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update ${performanceIssues} as pi set
          status = v.status,
          consecutive_passing_weeks = v.consecutive_passing_weeks,
          resolved_week = v.resolved_week,
          last_evaluated_week = v.last_evaluated_week,
          updated_at = now()
        from (values ${values}) as v(id, status, consecutive_passing_weeks, resolved_week, last_evaluated_week)
        where pi.id = v.id
      `);

      await tx.execute(sql`
        update ${actionItems} as ai set
          status = v.status,
          updated_at = now()
        from (values ${values}) as v(id, status, consecutive_passing_weeks, resolved_week, last_evaluated_week)
        where ai.performance_issue_id = v.id
      `);
    });
  }
}

async function applyOpens(
  opens: Array<{ employeeId: string; kpiId: string; state: PerformanceIssueState }>,
  week: string,
  live: Map<string, LiveIssue>,
): Promise<number> {
  if (opens.length === 0) return 0;

  const year = week.slice(0, 4);
  let created = 0;

  const CHUNK = 200;
  for (let i = 0; i < opens.length; i += CHUNK) {
    const slice = opens.slice(i, i + CHUNK);

    // A partial failure here is worse than a status mismatch — it's a
    // performance issue with no action item at all, since the two rows are
    // never both required to exist by anything short of this transaction.
    const issues = await db.transaction(async (tx) => {
      const issues = await tx
        .insert(performanceIssues)
        .values(
          slice.map((open) => ({
            code: sql`'PI-' || ${year} || '-' || lpad(nextval('performance_issue_seq')::text, 6, '0')`,
            employeeId: open.employeeId,
            kpiId: open.kpiId,
            status: open.state.status,
            openedWeek: open.state.openedWeek,
            consecutivePassingWeeks: open.state.consecutivePassingWeeks,
            lastEvaluatedWeek: week,
          })),
        )
        .returning({
          id: performanceIssues.id,
          employeeId: performanceIssues.employeeId,
          kpiId: performanceIssues.kpiId,
          status: performanceIssues.status,
          openedWeek: performanceIssues.openedWeek,
        });

      await tx.insert(actionItems).values(
        issues.map((issue) => ({
          code: sql`'PA-' || ${year} || '-' || lpad(nextval('action_item_seq')::text, 6, '0')`,
          performanceIssueId: issue.id,
          status: issue.status,
        })),
      );

      await tx.insert(weeklyIssueHistory).values(
        issues.map((issue) => ({
          performanceIssueId: issue.id,
          week,
          result: "fail" as const,
          consecutiveCountAfter: 0,
        })),
      ).onConflictDoNothing();

      await tx.insert(auditLog).values(
        issues.map((issue) => ({
          action: "issue.opened",
          entityType: "performance_issue",
          entityId: issue.id,
          after: { week, employeeId: issue.employeeId },
        })),
      );

      return issues;
    });

    for (const issue of issues) {
      live.set(`${issue.employeeId}|${issue.kpiId}`, {
        id: issue.id,
        employeeId: issue.employeeId,
        kpiId: issue.kpiId,
        lastEvaluatedWeek: week,
        state: {
          status: issue.status,
          consecutivePassingWeeks: 0,
          openedWeek: issue.openedWeek,
        },
      });
    }

    created += issues.length;
  }

  return created;
}

async function insertHistory(rows: Array<typeof weeklyIssueHistory.$inferInsert>) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(weeklyIssueHistory).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

async function insertEvents(rows: Array<typeof auditLog.$inferInsert>) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(auditLog).values(rows.slice(i, i + CHUNK));
  }
}
