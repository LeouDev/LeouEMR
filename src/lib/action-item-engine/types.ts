export type IssueStatus =
  | "OPEN"
  | "AWAITING_AGENT_ACKNOWLEDGEMENT"
  | "ACKNOWLEDGED"
  | "MONITORING"
  | "SUSTAINED"
  | "COMPLETED"
  | "REOPENED";

/**
 * The persistent thread a KPI failure creates. One PerformanceIssue exists
 * per (employee, KPI) failure lineage — it is never replaced week-to-week,
 * only updated in place, per spec section 4 ("Do NOT create a new
 * unrelated action item every week").
 */
export interface PerformanceIssueState {
  status: IssueStatus;
  consecutivePassingWeeks: number;
  openedWeek: string;
  resolvedWeek?: string;
}

export type WeeklyResult = "PASS" | "FAIL";

export type IssueEventType =
  | "ISSUE_OPENED"
  | "WEEK_FAILED_WHILE_ACTIVE"
  | "WEEK_PASSED_BEFORE_MONITORING"
  | "ISSUE_REOPENED"
  | "ISSUE_SUSTAINED"
  | "ISSUE_COMPLETED"
  | "RCA_ACTION_PLAN_SUBMITTED"
  | "AGENT_ACKNOWLEDGED";

export interface IssueEvent {
  type: IssueEventType;
  week: string;
}

export interface WeeklyEvaluationOutcome {
  issue: PerformanceIssueState | null;
  events: IssueEvent[];
}

export interface ActionItemEngineConfig {
  /** Number of consecutive passing weeks required to reach SUSTAINED. Default 4, per spec section 3. */
  requiredConsecutivePasses: number;
  /**
   * After this many days an issue whose KPI has recovered is closed on age
   * alone, without waiting for four consecutive passing weeks.
   *
   * Items that never got marked done pile up: 1,012 of 1,422 live issues were
   * past this line, and 651 of those had a passing KPI. An issue still failing
   * is never aged out, whatever its age — that is the case the queue exists to
   * surface, and hiding it would be the one outcome worse than a long list.
   */
  ageOutAfterDays: number;
}

export const DEFAULT_ACTION_ITEM_ENGINE_CONFIG: ActionItemEngineConfig = {
  requiredConsecutivePasses: 4,
  ageOutAfterDays: 60,
};
