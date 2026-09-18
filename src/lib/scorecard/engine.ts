import { computeSkillRating, computeSkillRatio, type RatingThresholds } from "@/lib/kpi-engine/par-mbo";
import {
  ATTENDANCE_BANDS,
  CRITICAL_ERROR_BANDS,
  IRE_BANDS,
  LH_UTILIZATION_BANDS,
  NPS_BANDS,
  PKT_BANDS,
  QUALITY_BANDS,
  STANDARD_ERROR_BANDS,
  rateOn,
  type RateBands,
} from "./bands";

/**
 * The monthly OptumRx scorecard, as a pure calculation.
 *
 * One card per person per calendar month: eight weighted rows, each rated
 * 1 to 5 on a band, weightage times rate summed to a final score out of 5,
 * with 3 the bare minimum. This module takes the month's figures already
 * measured (src/lib/scorecard/load.ts reads them) and decides the weights,
 * rates and score, so the whole of the business rule is pinned by tests
 * without a database.
 *
 * Two blocks share their 20 points by where the person's hours went:
 * Ancillary Quality and Phone Quality split the quality block, Critical
 * Errors (ancillary) and NPS (phone) split the errors block, each in the
 * ratio of ancillary to phone productive hours in the month. Everyone is
 * cross-skilled in practice, so a zero share is rare; when it happens the
 * row simply carries no weight rather than dragging the score.
 */

export const WEIGHTS = {
  productivity: 0.2,
  quality: 0.2,
  errors: 0.2,
  standardErrors: 0.1,
  ire: 0.1,
  pkt: 0.1,
  attendance: 0.05,
  lhUtilization: 0.05,
} as const;

/** Final score at or above this meets expectations. */
export const MINIMUM_SCORE = 3;

/**
 * IRE, PKT and LH Utilization arrive on a monthly sheet after the month
 * ends. Until a person's figure is there, full marks stand in for it: no
 * IRE, and 100 percent on the two percentages.
 */
export const MONTHLY_DEFAULTS = { ire: 0, pkt: 100, lhUtilization: 100 } as const;

export type SkillGroup = "phone" | "ancillary";

/**
 * Phone work is the handle-time skills (OBD Phone, PartD_Phones,
 * Gen_Phones, UHC_west, Clinical Appeals Phone); everything else,
 * OBD Special Project included, is ancillary.
 */
export function skillGroupOf(ref: { metric: string; lowerIsBetter: boolean }): SkillGroup {
  return ref.metric === "aht" || ref.lowerIsBetter ? "phone" : "ancillary";
}

export interface ScorecardSkillInput {
  code: string;
  name: string;
  group: SkillGroup;
  /** The month's productive hours on the skill — the weighting basis, the same one the PAR rating uses. */
  hours: number;
  /** The skill's measured value for the month (cases per hour, seconds per case, or case rate), or null when it could not be measured. */
  actual: number | null;
  /** The target the person was held to that month: the ramp-stage target for a ramping agent, the steady target otherwise. */
  target: number;
  lowerIsBetter: boolean;
  thresholds: RatingThresholds;
  /** Whether the month's target came from a ramp stage rather than the steady target. */
  ramping: boolean;
}

export interface ScorecardInputs {
  skills: ScorecardSkillInput[];
  /** Mean audit score over the month's ancillary audits, as a percentage; null with no audit. */
  ancillaryQuality: number | null;
  phoneQuality: number | null;
  /** Counts over the six months ending with this one. */
  criticalErrors: number;
  standardErrors: number;
  /** The month's NPS; null with no survey returned. */
  nps: number | null;
  /** The month's attendance percentage; null with no attendance rows. */
  attendance: number | null;
  /** From the Monthly sheet; null until the month's figure arrives. */
  ire: number | null;
  pkt: number | null;
  lhUtilization: number | null;
}

export type ScorecardRowKey =
  | "PRODUCTIVITY"
  | "ANCILLARY_QUALITY"
  | "PHONE_QUALITY"
  | "CRITICAL_ERRORS"
  | "NPS"
  | "STANDARD_ERRORS"
  | "IRE"
  | "PKT"
  | "ATTENDANCE"
  | "LH_UTILIZATION";

/**
 * How a row came to its rate:
 * - scored: measured and rated.
 * - defaulted: the Monthly sheet has no figure yet, so full marks stand in.
 * - no-weight: the block's hour share is zero, so the row carries no weight and is shown as a dash.
 * - no-data: the row has weight but nothing was measured; it is dropped and the rest rescaled.
 */
export type RowStatus = "scored" | "defaulted" | "no-weight" | "no-data";

export interface ProductivitySkillRow {
  code: string;
  name: string;
  group: SkillGroup;
  hours: number;
  /** Share of the person's productive hours, 0-1. */
  share: number;
  /** actual / target as a percentage (target / actual for handle time), null when unmeasured. */
  attainmentPct: number | null;
  rating: number | null;
  ramping: boolean;
  /** The sheet's rate columns for this skill: "127.27%-Higher", "116.82%-127.26%", ... */
  bandLabels: [string, string, string, string, string];
}

export interface ScorecardRow {
  key: ScorecardRowKey;
  label: string;
  /** The row's share of the card, 0-1, after the hour split. */
  weight: number;
  actual: number | null;
  /** 1.00-5.00; productivity interpolates, everything else is a whole rate. */
  rate: number | null;
  /** weight × rate, the sheet's "Weightage Score". */
  score: number | null;
  goal: number | null;
  bandLabels: [string, string, string, string, string] | null;
  status: RowStatus;
  /** Productivity only: the per-skill breakdown. */
  skills?: ProductivitySkillRow[];
}

export interface Scorecard {
  rows: ScorecardRow[];
  hours: { phone: number; ancillary: number; phoneShare: number; ancillaryShare: number };
  /** Weight that reached a rate, 0-1; 1 when every row scored. */
  weightScored: number;
  /** Sum of weight × rate over the scored rows. */
  rawScore: number;
  /** rawScore / weightScored, out of 5; null when nothing scored. */
  finalScore: number | null;
  /** Some weight was dropped for want of data, so the final score is read over what remains. */
  rescaled: boolean;
  meetsMinimum: boolean | null;
}

const pct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

/** The sheet's "Rate 5 … Rate 1" columns for a skill, from its R1-R5 ratio thresholds. */
export function skillBandLabels(t: RatingThresholds): [string, string, string, string, string] {
  return [
    `${pct(t.r5)}-Higher`,
    `${pct(t.r4)}-${pct(t.r5 - 0.0001)}`,
    `${pct(t.r3)}-${pct(t.r4 - 0.0001)}`,
    `${pct(t.r2)}-${pct(t.r3 - 0.0001)}`,
    `${pct(t.r2 - 0.0001)}-Below`,
  ];
}

function bandedRow(
  key: ScorecardRowKey,
  label: string,
  weight: number,
  actual: number | null,
  bands: RateBands,
  status: RowStatus = "scored",
): ScorecardRow {
  if (weight <= 0) {
    return { key, label, weight: 0, actual, rate: null, score: null, goal: bands.goal, bandLabels: bands.labels, status: "no-weight" };
  }
  if (actual === null) {
    return { key, label, weight, actual: null, rate: null, score: null, goal: bands.goal, bandLabels: bands.labels, status: "no-data" };
  }
  const rate = rateOn(bands, actual);
  return { key, label, weight, actual, rate, score: weight * rate, goal: bands.goal, bandLabels: bands.labels, status };
}

function productivityRow(skills: ScorecardSkillInput[]): ScorecardRow {
  const totalHours = skills.reduce((sum, s) => sum + s.hours, 0);
  const rows: ProductivitySkillRow[] = skills.map((s) => {
    const ratio = s.actual === null || s.target <= 0 ? null : computeSkillRatio(s.actual, s.target, s.lowerIsBetter);
    return {
      code: s.code,
      name: s.name,
      group: s.group,
      hours: s.hours,
      share: totalHours > 0 ? s.hours / totalHours : 0,
      attainmentPct: ratio === null ? null : ratio * 100,
      rating: ratio === null ? null : computeSkillRating(ratio, s.thresholds),
      ramping: s.ramping,
      bandLabels: skillBandLabels(s.thresholds),
    };
  });

  // Only skills that could be measured carry weight in the rate, in the
  // proportion of their hours to each other — the same hours-weighted mean
  // the PAR rating is.
  const rated = rows.filter((r) => r.rating !== null);
  const ratedHours = rated.reduce((sum, r) => sum + r.hours, 0);
  const rate =
    rated.length > 0 && ratedHours > 0
      ? rated.reduce((sum, r) => sum + (r.rating ?? 0) * (r.hours / ratedHours), 0)
      : null;

  return {
    key: "PRODUCTIVITY",
    label: "Productivity",
    weight: WEIGHTS.productivity,
    actual: rate,
    rate,
    score: rate === null ? null : WEIGHTS.productivity * rate,
    goal: null,
    bandLabels: null,
    status: rate === null ? "no-data" : "scored",
    skills: rows,
  };
}

/** Builds the month's card from its measured figures. */
export function computeScorecard(inputs: ScorecardInputs): Scorecard {
  const phoneHours = inputs.skills.filter((s) => s.group === "phone").reduce((n, s) => n + s.hours, 0);
  const ancillaryHours = inputs.skills.filter((s) => s.group === "ancillary").reduce((n, s) => n + s.hours, 0);
  const total = phoneHours + ancillaryHours;
  const phoneShare = total > 0 ? phoneHours / total : 0;
  const ancillaryShare = total > 0 ? ancillaryHours / total : 0;

  const rows: ScorecardRow[] = [
    productivityRow(inputs.skills),
    bandedRow("ANCILLARY_QUALITY", "Ancillary Quality", WEIGHTS.quality * ancillaryShare, inputs.ancillaryQuality, QUALITY_BANDS),
    bandedRow("PHONE_QUALITY", "Phone Quality", WEIGHTS.quality * phoneShare, inputs.phoneQuality, QUALITY_BANDS),
    bandedRow("CRITICAL_ERRORS", "Critical Error", WEIGHTS.errors * ancillaryShare, inputs.criticalErrors, CRITICAL_ERROR_BANDS),
    bandedRow("NPS", "NPS", WEIGHTS.errors * phoneShare, inputs.nps, NPS_BANDS),
    bandedRow("STANDARD_ERRORS", "Standard Error", WEIGHTS.standardErrors, inputs.standardErrors, STANDARD_ERROR_BANDS),
    bandedRow("IRE", "IRE", WEIGHTS.ire, inputs.ire ?? MONTHLY_DEFAULTS.ire, IRE_BANDS, inputs.ire === null ? "defaulted" : "scored"),
    bandedRow("PKT", "PKT", WEIGHTS.pkt, inputs.pkt ?? MONTHLY_DEFAULTS.pkt, PKT_BANDS, inputs.pkt === null ? "defaulted" : "scored"),
    bandedRow("ATTENDANCE", "Attendance", WEIGHTS.attendance, inputs.attendance, ATTENDANCE_BANDS),
    bandedRow(
      "LH_UTILIZATION",
      "LH Utilization",
      WEIGHTS.lhUtilization,
      inputs.lhUtilization ?? MONTHLY_DEFAULTS.lhUtilization,
      LH_UTILIZATION_BANDS,
      inputs.lhUtilization === null ? "defaulted" : "scored",
    ),
  ];

  const scored = rows.filter((r) => r.rate !== null);
  const weightScored = scored.reduce((sum, r) => sum + r.weight, 0);
  const rawScore = scored.reduce((sum, r) => sum + (r.score ?? 0), 0);
  // Weight the hour split assigned but nothing measured against; a zero
  // share is not a gap, it is a row that does not apply.
  const weightMissing = rows.filter((r) => r.status === "no-data").reduce((sum, r) => sum + r.weight, 0);

  /**
   * A month with no productive hours has no score at all, rather than a
   * high one.
   *
   * Everything keyed to hours falls away at zero. Productivity has no skill
   * to rate, and Ancillary Quality, Phone Quality, Critical Error and NPS
   * are each weighted by the phone/ancillary hour split, so at a zero split
   * they carry no weight to begin with. That is 80% of the card gone.
   * What is left is IRE, PKT and LH Utilization — and until the Monthly
   * sheet exists, every one of those stands in at MONTHLY_DEFAULTS, which
   * rate 5, 5 and 5.
   *
   * So the arithmetic returned a perfect 5.00 over a quarter of the card,
   * not one point of it measured, and the stack rank duly put people who
   * had not worked a single productive hour above everyone who had.
   * Rescaling is meant to read a partial card fairly; it cannot invent a
   * card out of three placeholders.
   */
  const productiveHours = phoneHours + ancillaryHours;
  const finalScore = weightScored > 0 && productiveHours > 0 ? rawScore / weightScored : null;

  return {
    rows,
    hours: { phone: phoneHours, ancillary: ancillaryHours, phoneShare, ancillaryShare },
    weightScored,
    rawScore,
    finalScore,
    rescaled: weightMissing > 1e-9 && weightScored > 0,
    meetsMinimum: finalScore === null ? null : finalScore >= MINIMUM_SCORE,
  };
}
