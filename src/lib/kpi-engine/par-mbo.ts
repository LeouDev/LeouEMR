/**
 * PAR/MBO scoring engine, ported from the existing MBO2 app
 * (LeouDev/MBO2, index.html computeSkillRating/computeEmployee,
 * ~lines 2018-2108) and decomposed into three independent KPIs
 * (Production Rate, DPU, DPO) instead of one opaque AND-gated isPass().
 *
 * The rating curve is intentionally NOT symmetric: below-target ratios
 * step flat between whole ratings (no interpolation), while at/above-target
 * ratios interpolate smoothly up to 5.00. This matches the behavior of the
 * source app exactly (rating === 3.00 for a skill performed exactly at
 * target) and is preserved here rather than "fixed," since it's an
 * established, understood scoring convention for this organization.
 */

export interface RatingThresholds {
  /** Ratio -> rating anchor points. r3 is conventionally 1.00 (on-target), r1 is conventionally 0. */
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
}

/**
 * Converts an actual/target ratio into a 1.00-5.00 rating.
 * Bands whose upper rating is <= 3 (R1->R2, R2->R3) are a step function.
 * Bands whose upper rating is > 3 (R3->R4, R4->R5) interpolate linearly.
 */
export function computeSkillRating(ratio: number, thresholds: RatingThresholds): number {
  const pairs: Array<[number, number]> = (
    [
      [thresholds.r1, 1],
      [thresholds.r2, 2],
      [thresholds.r3, 3],
      [thresholds.r4, 4],
      [thresholds.r5, 5],
    ] as Array<[number, number]>
  ).sort((a, b) => a[0] - b[0]);

  const [lowestThreshold, lowestRating] = pairs[0];
  const [highestThreshold, highestRating] = pairs[pairs.length - 1];

  if (ratio <= lowestThreshold) return lowestRating;
  if (ratio >= highestThreshold) return highestRating;

  for (let i = 0; i < pairs.length - 1; i++) {
    const [lowerT, lowerR] = pairs[i];
    const [upperT, upperR] = pairs[i + 1];
    if (ratio >= lowerT && ratio < upperT) {
      if (upperR <= 3) {
        // Step band: flat at the lower rating until the next threshold is reached.
        return lowerR;
      }
      const frac = (ratio - lowerT) / (upperT - lowerT);
      return lowerR + frac * (upperR - lowerR);
    }
  }

  // Unreachable given the clamps above, but keeps the function total.
  return lowestRating;
}

export interface SkillPerformance {
  skillCode: string;
  actual: number;
  target: number;
  thresholds: RatingThresholds;
  hoursWorked: number;
  lowerIsBetter?: boolean;
}

export interface EmployeeSkillResult {
  skillCode: string;
  ratio: number;
  rating: number;
  weight: number;
}

export interface EmployeeProductionResult {
  finalRate: number;
  totalHours: number;
  skills: EmployeeSkillResult[];
}

/**
 * Ratio direction mirrors the KPI engine's higher/lower-is-better split.
 * For lower-is-better skills (AHT-style, where a smaller actual is better)
 * the ratio inverts so a faster actual still maps to a higher rating.
 */
export function computeSkillRatio(actual: number, target: number, lowerIsBetter: boolean): number {
  if (lowerIsBetter) {
    if (actual === 0) return 0;
    return target / actual;
  }
  if (target === 0) return 0;
  return actual / target;
}

/**
 * Hours-weighted aggregate across every skill an employee worked in the
 * period: each skill's rating is weighted by that skill's share of the
 * employee's total production hours.
 */
export function computeEmployeeFinalRate(skills: SkillPerformance[]): EmployeeProductionResult {
  const totalHours = skills.reduce((sum, s) => sum + s.hoursWorked, 0);

  const results: EmployeeSkillResult[] = skills.map((s) => {
    const ratio = computeSkillRatio(s.actual, s.target, s.lowerIsBetter ?? false);
    const rating = computeSkillRating(ratio, s.thresholds);
    const weight = totalHours > 0 ? s.hoursWorked / totalHours : 0;
    return { skillCode: s.skillCode, ratio, rating, weight };
  });

  const finalRate = results.reduce((sum, r) => sum + r.rating * r.weight, 0);

  return { finalRate, totalHours, skills: results };
}

export interface QualityTally {
  audits: number;
  under100: number;
  markdown: number;
  totalAttributes: number;
}

export interface QualityMetrics {
  /** Defects per unit: fraction of audits with no markdown. Null if there were no audits. */
  dpu: number | null;
  /** Defects per opportunity: fraction of scored attributes with no markdown. Null if there were no attributes. */
  dpo: number | null;
}

export function computeQualityMetrics(tally: QualityTally): QualityMetrics {
  return {
    dpu: tally.audits > 0 ? (tally.audits - tally.under100) / tally.audits : null,
    dpo: tally.totalAttributes > 0 ? (tally.totalAttributes - tally.markdown) / tally.totalAttributes : null,
  };
}
