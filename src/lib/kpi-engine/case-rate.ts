/**
 * Case rate: production weight earned per case, for agents on case-rate
 * skills.
 *
 * Case-rate skills emit no cases-per-hour or handle-time facts at all (see
 * aggregate.ts), so this is the only output figure such an agent has. It is
 * scored against the agent's own skill mix rather than one blended number:
 * each case-rate skill carries its own target weight per case (8 to 15
 * across the reference table), so the bar is the weight those skills
 * expected of the cases actually worked — sum(target × cases). Producing at
 * least that much passes.
 *
 * Summed across skills and divided once, never averaged per skill: a
 * handful of cases on a demanding skill must not drag a verdict that three
 * hundred cases on an easier one had already earned.
 *
 * One formula, used by the import (the weekly ledger row the action-item
 * engine reads), by period re-aggregation (a month re-divides its totals),
 * and by the views that still fill gaps from the daily facts.
 */

/** The KPI definition code, seeded by migration 0041. */
export const CASE_RATE_KPI_CODE = "CASE_RATE";

export interface CaseRateSkillTotals {
  cases: number;
  prodWeight: number;
  /** The skill's reference target: production weight expected per case. */
  targetPerCase: number;
}

export interface BlendedCaseRate {
  /** Production weight per case, across every case-rate skill worked. */
  rate: number;
  /** What the skill mix expected per case, on the same basis. */
  target: number;
  status: "PASS" | "FAIL";
  /** Cases behind the figure, for the sample size. */
  cases: number;
}

export function blendCaseRate(skills: CaseRateSkillTotals[]): BlendedCaseRate | null {
  let cases = 0;
  let prodWeight = 0;
  let expected = 0;
  for (const skill of skills) {
    cases += skill.cases;
    prodWeight += skill.prodWeight;
    expected += skill.targetPerCase * skill.cases;
  }
  // No cases, or cases with no weight recorded against them, is no
  // measurement — never a zero rate that would read as a collapse.
  if (cases <= 0 || prodWeight <= 0) return null;

  return {
    rate: prodWeight / cases,
    target: expected / cases,
    status: prodWeight >= expected ? "PASS" : "FAIL",
    cases,
  };
}
