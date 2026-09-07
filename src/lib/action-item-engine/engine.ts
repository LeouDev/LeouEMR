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
