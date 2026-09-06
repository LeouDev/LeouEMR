import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  actionItems,
  auditLog,
  kpiDefinitions,
  performanceIssues,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { evaluateWeeklyResult } from "./engine";
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
  const result: EngineRunResult = { opened: 0, updated: 0, completed: 0 };
  if (weeks.length === 0) return result;

  const live = await loadLiveIssues();

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

      // Already folded in: re-importing the same or an earlier week is a no-op.
      if (existing?.lastEvaluatedWeek && existing.lastEvaluatedWeek >= week) continue;

      // WARNING sits above the failure threshold, so it counts as a pass.
      const weekResult = metric.status === "fail" ? "FAIL" : "PASS";

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

  return result;
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

    await db.execute(sql`
      update ${performanceIssues} as pi set
        status = v.status,
        consecutive_passing_weeks = v.consecutive_passing_weeks,
        resolved_week = v.resolved_week,
        last_evaluated_week = v.last_evaluated_week,
        updated_at = now()
      from (values ${values}) as v(id, status, consecutive_passing_weeks, resolved_week, last_evaluated_week)
      where pi.id = v.id
    `);

    await db.execute(sql`
      update ${actionItems} as ai set
        status = v.status,
        updated_at = now()
      from (values ${values}) as v(id, status, consecutive_passing_weeks, resolved_week, last_evaluated_week)
      where ai.performance_issue_id = v.id
    `);
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

    const issues = await db
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

    await db.insert(actionItems).values(
      issues.map((issue) => ({
        code: sql`'PA-' || ${year} || '-' || lpad(nextval('action_item_seq')::text, 6, '0')`,
        performanceIssueId: issue.id,
        status: issue.status,
      })),
    );

    await db.insert(weeklyIssueHistory).values(
      issues.map((issue) => ({
        performanceIssueId: issue.id,
        week,
        result: "fail" as const,
        consecutiveCountAfter: 0,
      })),
    ).onConflictDoNothing();

    await db.insert(auditLog).values(
      issues.map((issue) => ({
        action: "issue.opened",
        entityType: "performance_issue",
        entityId: issue.id,
        after: { week, employeeId: issue.employeeId },
      })),
    );

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
