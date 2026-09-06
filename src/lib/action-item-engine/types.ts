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
}

export const DEFAULT_ACTION_ITEM_ENGINE_CONFIG: ActionItemEngineConfig = {
  requiredConsecutivePasses: 4,
};
