import {
  DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
  type ActionItemEngineConfig,
  type IssueEvent,
  type IssueStatus,
  type PerformanceIssueState,
  type WeeklyEvaluationOutcome,
  type WeeklyResult,
} from "./types";

/**
 * The 4-week sustained-performance rule (spec sections 3-6, 10, 26-27).
 *
 * This is the ONLY function that decides how a performance issue's status
 * and consecutive-passing-week counter change in response to one week's
 * PASS/FAIL result. It is a pure function — no DB access, no dates, no
 * side effects — specifically so the exact scenarios in section 27 can be
 * asserted against directly, and so this logic can be unit tested
 * independently of the import pipeline, the KPI engine, and the UI.
 *
 * Administrative transitions that are NOT driven by a weekly result
 * (supervisor finishing RCA/Action Plan, agent acknowledging) are separate
 * functions below — submitRcaAndActionPlan / acknowledgeByAgent — because
 * they can happen at any time, not just at week boundaries.
 *
 * States that are "actively counting toward sustained improvement":
 * ACKNOWLEDGED, MONITORING, SUSTAINED. A PASS in any of these advances the
 * counter (and promotes ACKNOWLEDGED -> MONITORING on its first pass). A
 * FAIL only resets/reopens if real progress had been made (MONITORING or
 * SUSTAINED) — failing while still ACKNOWLEDGED (no passes recorded yet)
 * is just "still failing," not a reopen, since there was nothing to lose.
 */
export function evaluateWeeklyResult(
  issue: PerformanceIssueState | null,
  weekResult: WeeklyResult,
  week: string,
  config: ActionItemEngineConfig = DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
): WeeklyEvaluationOutcome {
  const events: IssueEvent[] = [];

  if (!issue || issue.status === "COMPLETED") {
    if (weekResult === "FAIL") {
      events.push({ type: "ISSUE_OPENED", week });
      return {
        issue: { status: "OPEN", consecutivePassingWeeks: 0, openedWeek: week },
        events,
      };
    }
    // No active issue and the week passed — nothing to track.
    return { issue: issue ?? null, events };
  }

  if (weekResult === "FAIL") {
    if (issue.status === "MONITORING" || issue.status === "SUSTAINED") {
      events.push({ type: "ISSUE_REOPENED", week });
      return {
        issue: { ...issue, status: "REOPENED", consecutivePassingWeeks: 0 },
        events,
      };
    }
    // OPEN / AWAITING_AGENT_ACKNOWLEDGEMENT / ACKNOWLEDGED / REOPENED:
    // already an active thread with no monitoring progress to lose.
    events.push({ type: "WEEK_FAILED_WHILE_ACTIVE", week });
    return { issue: { ...issue, consecutivePassingWeeks: 0 }, events };
  }

  // weekResult === "PASS"
  if (
    issue.status === "ACKNOWLEDGED" ||
    issue.status === "MONITORING" ||
    issue.status === "SUSTAINED"
  ) {
    const consecutivePassingWeeks = issue.consecutivePassingWeeks + 1;

    if (issue.status === "SUSTAINED" && consecutivePassingWeeks >= config.requiredConsecutivePasses + 1) {
      events.push({ type: "ISSUE_COMPLETED", week });
      return {
        issue: { ...issue, status: "COMPLETED", consecutivePassingWeeks, resolvedWeek: week },
        events,
      };
    }

    if (consecutivePassingWeeks >= config.requiredConsecutivePasses) {
      events.push({ type: "ISSUE_SUSTAINED", week });
      return { issue: { ...issue, status: "SUSTAINED", consecutivePassingWeeks }, events };
    }

    return { issue: { ...issue, status: "MONITORING", consecutivePassingWeeks }, events };
  }

  // OPEN / AWAITING_AGENT_ACKNOWLEDGEMENT / REOPENED and passing: the
  // administrative workflow (RCA, action plan, acknowledgement) hasn't
  // caught up yet, so monitoring hasn't started — the pass is logged but
  // doesn't advance the counter.
  events.push({ type: "WEEK_PASSED_BEFORE_MONITORING", week });
  return { issue, events };
}

/** Outcome shape for transitions that always start from (and produce) a real issue — never null. */
interface IssueTransitionOutcome {
  issue: PerformanceIssueState;
  events: IssueEvent[];
}

/**
 * Supervisor has completed the RCA and Action Plan required fields
 * (see src/lib/rca-action-plan) and the item can now be sent to the agent.
 * Valid from OPEN or REOPENED only — see spec section 8.
 */
export function submitRcaAndActionPlan(
  issue: PerformanceIssueState,
  week: string,
): IssueTransitionOutcome {
  if (issue.status !== "OPEN" && issue.status !== "REOPENED") {
    throw new Error(
      `Cannot submit RCA/Action Plan from status "${issue.status}" — must be OPEN or REOPENED`,
    );
  }
  return {
    issue: { ...issue, status: "AWAITING_AGENT_ACKNOWLEDGEMENT" },
    events: [{ type: "RCA_ACTION_PLAN_SUBMITTED", week }],
  };
}

/** Agent has reviewed and acknowledged the action item (spec section 9). */
export function acknowledgeByAgent(
  issue: PerformanceIssueState,
  week: string,
): IssueTransitionOutcome {
  if (issue.status !== "AWAITING_AGENT_ACKNOWLEDGEMENT") {
    throw new Error(
      `Cannot acknowledge from status "${issue.status}" — must be AWAITING_AGENT_ACKNOWLEDGEMENT`,
    );
  }
  return {
    issue: { ...issue, status: "ACKNOWLEDGED" },
    events: [{ type: "AGENT_ACKNOWLEDGED", week }],
  };
}

/**
 * Folds a full weekly history through evaluateWeeklyResult, for tests and
 * for replaying an employee's issue history end-to-end. Does not perform
 * the RCA/acknowledgement steps — pass `autoAcknowledgeAfterFailure: true`
 * to simulate an org where that always happens same-week (useful for
 * exercising the pure 4-week counting rule in isolation, as in section 27).
 */
export function runWeeklyHistory(
  weeks: Array<{ week: string; result: WeeklyResult }>,
  config: ActionItemEngineConfig = DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
  options: { autoAcknowledgeAfterFailure?: boolean } = {},
): { issue: PerformanceIssueState | null; history: WeeklyEvaluationOutcome[] } {
  let issue: PerformanceIssueState | null = null;
  const history: WeeklyEvaluationOutcome[] = [];

  for (const { week, result } of weeks) {
    const outcome = evaluateWeeklyResult(issue, result, week, config);
    issue = outcome.issue;
    history.push(outcome);

    if (options.autoAcknowledgeAfterFailure && issue) {
      if (issue.status === "OPEN" || issue.status === "REOPENED") {
        issue = submitRcaAndActionPlan(issue, week).issue;
      }
      if (issue?.status === "AWAITING_AGENT_ACKNOWLEDGEMENT") {
        issue = acknowledgeByAgent(issue, week).issue;
      }
    }
  }

  return { issue, history };
}

/**
 * Whether a live issue's already-folded weekly history can be safely
 * rebuilt from scratch after the weekly data behind it changes (a ramp
 * target correction, a routing fix, a corrected re-import).
 *
 * Only issues with zero human decisions layered on top qualify. A
 * corrected weekly value can tell us what the mechanical pass/fail
 * bookkeeping should have been, but it cannot tell us what a supervisor's
 * RCA, an agent's acknowledgement, or an already-completed episode would
 * have looked like under the corrected numbers — those are left for a
 * person to review (see persistence.ts's stale-week handling) rather than
 * silently rewritten.
 */
export function canAutoReplay(context: {
  status: IssueStatus;
  hasRca: boolean;
  hasActionPlan: boolean;
  hasNotes: boolean;
  /** A prior episode (e.g. a completed-then-reopened lineage) for the same employee+KPI. */
  hasOtherIssuesForKpi: boolean;
}): boolean {
  return (
    (context.status === "OPEN" || context.status === "REOPENED") &&
    !context.hasRca &&
    !context.hasActionPlan &&
    !context.hasNotes &&
    !context.hasOtherIssuesForKpi
  );
}

export interface ReplayedWeek {
  week: string;
  result: "pass" | "fail";
  consecutiveCountAfter: number;
}

/**
 * Rebuilds one employee+KPI's full issue trajectory from their current
 * weekly results, for comparison against (and correction of) what was
 * actually folded in and stored.
 *
 * Mirrors persistence.ts's own per-week folding exactly: a week only
 * carries a history row once an issue exists (from its opened week
 * onward), which is why weeks before the first fail are dropped here
 * rather than recorded with a null issue.
 */
export function replayEmployeeKpiHistory(
  weeklyResults: Array<{ week: string; status: "pass" | "warning" | "fail" }>,
  config: ActionItemEngineConfig = DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
): { issue: PerformanceIssueState | null; history: ReplayedWeek[] } {
  const weeks = weeklyResults.map((r) => ({
    week: r.week,
    result: (r.status === "fail" ? "FAIL" : "PASS") as WeeklyResult,
  }));

  const { issue, history } = runWeeklyHistory(weeks, config);

  const replayed: ReplayedWeek[] = [];
  history.forEach((outcome, i) => {
    if (!outcome.issue) return;
    replayed.push({
      week: weeks[i].week,
      result: weeks[i].result === "FAIL" ? "fail" : "pass",
      consecutiveCountAfter: outcome.issue.consecutivePassingWeeks,
    });
  });

  return { issue, history: replayed };
}

/**
 * Whether a long-running issue should be closed on age alone.
 *
 * The four-consecutive-passing-weeks rule closes an issue properly, but it
 * only fires while weeks keep arriving for that employee and KPI. An agent who
 * recovered and then moved queue, changed skill, or simply stopped being
 * measured on it leaves an issue open forever. Age closes those.
 *
 * Two conditions, both required. The issue must be older than the threshold,
 * measured in reporting days from its most recent failure — the week it
 * opened, or the latest failing week since — not wall-clock time, so a
 * database restored or imported late does not age everything out at once.
 * Counting from the opening week alone closed an item that had relapsed a
 * week earlier: once it was past the threshold, a single passing week after
 * the relapse read as "recovered", the item closed on age, and the next
 * failure opened a second item for the same problem.
 * And its KPI must have recovered: the most recent result on record is not a
 * failure. An issue still failing is never aged out however old it is, because
 * closing it would delete the only standing record that someone needs help.
 *
 * No result at all counts as not recovered. Absence of evidence is not
 * evidence of recovery, and an issue with nothing behind it is exactly the
 * kind that should be looked at rather than quietly closed.
 */
export function shouldAgeOut(
  issue: {
    status: IssueStatus;
    openedWeek: string;
    /** The most recent failing week on record for this employee and KPI, when there is one. */
    lastFailedWeek?: string | null;
    /** Status of the most recent weekly result for this employee and KPI. */
    latestResult: "pass" | "warning" | "fail" | null;
  },
  /** The newest reporting week end — this data's "today". */
  asOf: string,
  config: ActionItemEngineConfig = DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
): boolean {
  if (issue.status === "COMPLETED") return false;
  if (issue.latestResult === null || issue.latestResult === "fail") return false;

  // The clock starts at the last failure. A relapse restarts it; a failing
  // week recorded before the item opened (an earlier episode's) does not.
  const since =
    issue.lastFailedWeek && issue.lastFailedWeek > issue.openedWeek
      ? issue.lastFailedWeek
      : issue.openedWeek;
  const failed = Date.parse(`${since}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(failed) || Number.isNaN(now)) return false;

  const days = (now - failed) / 86_400_000;
  return days >= config.ageOutAfterDays;
}

/**
 * Whether an issue's KPI has simply stopped being measured.
 *
 * A second, separate ground for closing, and the one `shouldAgeOut` above
 * cannot reach. That rule refuses to close anything whose last recorded week
 * was a failure — "still failing is never aged out" — which is right while
 * weeks are still arriving and a deadlock once they stop. An agent who moved
 * queue, went on leave or left the account while their last week was red then
 * holds an item that can never pass, because no weeks arrive to pass, and can
 * never age out, because the last one failed. It sits on their team leader's
 * board for ever, counted among the work that leader owes.
 *
 * So a KPI that has gone quiet for `notMeasuredAfterWeeks` closes the item on
 * that ground alone, whatever the last week said. That is a different
 * statement from recovery and the audit log records it as a different one:
 * nobody is claiming this agent improved, only that there is nothing left to
 * measure them against.
 *
 * Measured from the last week on record rather than from the last failing
 * week, because the question is when the data stopped, not when it last went
 * wrong. Both weeks are the same one in the case this exists for.
 *
 * An issue with no result at all behind it is still left alone: there is no
 * last week to count six from, and an item with nothing underneath it is the
 * kind to look at rather than close quietly.
 */
export function noLongerMeasured(
  issue: {
    status: IssueStatus;
    /** The week of the most recent result on record, when there is one. */
    latestResultWeek?: string | null;
  },
  /** The newest reporting week in the ledger — this data's "today". */
  asOf: string,
  config: ActionItemEngineConfig = DEFAULT_ACTION_ITEM_ENGINE_CONFIG,
): boolean {
  if (issue.status === "COMPLETED") return false;
  if (!issue.latestResultWeek) return false;

  const last = Date.parse(`${issue.latestResultWeek}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(last) || Number.isNaN(now)) return false;

  const weeks = (now - last) / 86_400_000 / 7;
  return weeks >= config.notMeasuredAfterWeeks;
}

/**
 * The separations the sweep may act on: only those the employee row
 * confirms. Both ways a person really leaves — a masterlist's attrition
 * pass and an EWS separating tag — also mark the row `separated` as they
 * do; a separation inferred from the assignment history while the row is
 * still active is a broken org history, not a departure, and closing work
 * on it is irreversible. (17 Sep 2026: a splice bug closed a listed team's
 * intervals at a month's eve and the sweep completed 33 of their
 * development items.) Anyone the row does not confirm is left alone; the
 * nightly integrity check reports the disagreement instead.
 */
export function confirmedSeparations(
  inferred: ReadonlyMap<string, string>,
  statusById: ReadonlyMap<string, string>,
): Map<string, string> {
  const confirmed = new Map<string, string>();
  for (const [employeeId, on] of inferred) {
    if (statusById.get(employeeId) === "separated") confirmed.set(employeeId, on);
  }
  return confirmed;
}

/**
 * The week each open issue of someone who has left is resolved as of: the
 * reporting week their separation date falls in, so the record shows the
 * work ending when they did rather than when the sweep happened to run —
 * but never before the week the issue itself opened. A separation recorded
 * after the fact (a masterlist closing someone as of last month's end,
 * once this month's weeks had already opened work for them) would
 * otherwise resolve an issue before it existed. Grouped by week so the
 * caller writes one statement per week, not per issue. An issue whose
 * owner has no separation date is left out.
 */
export function separationResolutionWeeks(
  open: ReadonlyArray<{ id: string; employeeId: string; openedWeek: string }>,
  leftOn: ReadonlyMap<string, string>,
  weekStartOf: (date: string) => string,
): Map<string, string[]> {
  const byWeek = new Map<string, string[]>();
  for (const issue of open) {
    const on = leftOn.get(issue.employeeId);
    if (on === undefined) continue;
    const separationWeek = weekStartOf(on);
    const week = separationWeek > issue.openedWeek ? separationWeek : issue.openedWeek;
    const ids = byWeek.get(week);
    if (ids) ids.push(issue.id);
    else byWeek.set(week, [issue.id]);
  }
  return byWeek;
}
