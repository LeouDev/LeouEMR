/**
 * Early Warning System risk engine, ported from the existing EWS app
 * (LeouDev/EarlyWarningSigns, calcScore/calcStatus).
 *
 * The behavior is preserved exactly — a flagged-indicator count plus one
 * point for an active CAP, banded 0 / 1-3 / 4+ — because it is an
 * established, understood scale for this organization. What changes is that
 * the indicator taxonomy is configuration here rather than a hardcoded
 * array, and thresholds are named constants rather than inline literals.
 */

export type EwsRiskLevel = "GREEN" | "YELLOW" | "RED" | "BLACK";

export type EwsAttrition = "none" | "black" | "absconding" | "loa" | "maternity";

export const EWS_ATTRITION_CODES: readonly EwsAttrition[] = ["none", "black", "absconding", "loa", "maternity"];

/** Absence states that are not attrition but still warrant a red flag. */
const LEAVE_STATES: EwsAttrition[] = ["absconding", "loa", "maternity"];

/** The tags that force the RED band whatever the score: away, for whatever reason. */
export function isLeaveState(attrition: EwsAttrition): boolean {
  return LEAVE_STATES.includes(attrition);
}

/**
 * Away and expected back: a leave of absence or maternity. Absconding is
 * not one of these — someone who stopped turning up without notice is an
 * exit (`employeeStatusFor` separates them and their open work closes),
 * so the tracker lists them with the exits, not on the leave register,
 * and asks for no return date.
 */
export function expectsReturn(attrition: EwsAttrition): attrition is "loa" | "maternity" {
  return attrition === "loa" || attrition === "maternity";
}

/** The tags that take someone off the roster for good, until restored. */
export function isExit(attrition: EwsAttrition): attrition is "black" | "absconding" {
  return attrition === "black" || attrition === "absconding";
}

export const EWS_ATTRITION_LABELS: Record<EwsAttrition, string> = {
  none: "Active — no attrition",
  black: "Resignation / termination",
  absconding: "Absconding",
  loa: "Leave of absence",
  maternity: "Maternity",
};

/**
 * What the team leader has decided to do about someone: the tracker's
 * escalation ladder, stored as its code on the assessment.
 */
export type EwsActionPlan = "MONITORING" | "SKIP_LEVEL" | "ADMIN_HEARING" | "OTHER";

export const EWS_ACTION_PLANS: Array<{ code: EwsActionPlan; label: string }> = [
  { code: "MONITORING", label: "For Monitoring" },
  { code: "SKIP_LEVEL", label: "For SKIP Level" },
  { code: "ADMIN_HEARING", label: "For Admin Hearing" },
  { code: "OTHER", label: "Other" },
];

export function actionPlanLabel(code: string | null): string | null {
  return EWS_ACTION_PLANS.find((p) => p.code === code)?.label ?? null;
}

export const EWS_THRESHOLDS = {
  /** A score at or below this is GREEN. */
  green: 0,
  /** A score at or below this (and above green) is YELLOW; anything higher is RED. */
  yellow: 3,
} as const;

export interface EwsAssessmentInput {
  /** Indicator code -> whether the supervisor flagged it. */
  indicators: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
}

/** Flagged indicators, plus one point for an active corrective action plan. */
export function computeEwsScore(input: EwsAssessmentInput): number {
  const flagged = Object.values(input.indicators).filter(Boolean).length;
  return flagged + (input.capActive ? 1 : 0);
}

/**
 * Confirmed attrition overrides the score entirely, and the leave states
 * force RED regardless of score — matching the source app, where someone on
 * an unplanned absence is a live risk however clean their indicators look.
 */
export function computeEwsRisk(input: EwsAssessmentInput): {
  score: number;
  riskLevel: EwsRiskLevel;
} {
  const score = computeEwsScore(input);

  if (input.attrition === "black") return { score, riskLevel: "BLACK" };
  if (LEAVE_STATES.includes(input.attrition)) return { score, riskLevel: "RED" };

  if (score <= EWS_THRESHOLDS.green) return { score, riskLevel: "GREEN" };
  if (score <= EWS_THRESHOLDS.yellow) return { score, riskLevel: "YELLOW" };
  return { score, riskLevel: "RED" };
}

export const EWS_RISK_LABELS: Record<EwsRiskLevel, string> = {
  GREEN: "Stable",
  YELLOW: "Watch",
  RED: "At risk",
  BLACK: "Critical",
};

export const EWS_RISK_GUIDANCE: Record<EwsRiskLevel, string> = {
  GREEN: "Engaged and performing well.",
  YELLOW: "Mild warning signs. Schedule a one-on-one and document observations.",
  RED: "Multiple warning signs. Hold a retention conversation and escalate if needed.",
  BLACK: "Confirmed resignation or termination. Begin the transition plan.",
};

export type EmployeeStatus = "active" | "on_leave" | "separated";

/**
 * The employment status an attrition tag implies.
 *
 * The four tags are not one thing. A resignation or an absconding is an exit:
 * the person is not coming back, and their open work should close. Maternity
 * and a leave of absence are a pause: they return, and closing their action
 * items would mean they come back to a clean slate that misrepresents where
 * they left off.
 *
 * Clearing the tag returns them to active, which is what makes the leave
 * states reversible — a returning agent needs no separate action.
 */
export function employeeStatusFor(attrition: EwsAttrition): EmployeeStatus {
  if (attrition === "black" || attrition === "absconding") return "separated";
  if (attrition === "loa" || attrition === "maternity") return "on_leave";
  return "active";
}
