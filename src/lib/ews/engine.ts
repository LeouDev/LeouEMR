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

/** Absence states that are not attrition but still warrant a red flag. */
const LEAVE_STATES: EwsAttrition[] = ["absconding", "loa", "maternity"];

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
