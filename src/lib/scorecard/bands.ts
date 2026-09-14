/**
 * The fixed rate bands of the monthly scorecard, one per metric row, as
 * the business's scorecard workbook lays them out: a goal, and the value
 * that earns each rate from 5 down to 2, with anything past the rate-2
 * line rating 1. Productivity is the exception — each skill carries its
 * own R1-R5 curve on skill_references — so it is not here.
 *
 * Counts are lower-is-better (a smaller count earns the higher rate);
 * everything else is higher-is-better. A null cut means the sheet has no
 * such rate for that row (IRE has no 4; LH Utilization has no 4 or 3).
 */
export type Rate = 1 | 2 | 3 | 4 | 5;

export interface RateBands {
  direction: "higher" | "lower";
  goal: number;
  /**
   * The cut for rates 5, 4, 3 and 2 in that order. Higher-is-better: the
   * lowest value that earns the rate. Lower-is-better: the highest value
   * that still earns it.
   */
  cuts: [number | null, number | null, number | null, number | null];
  /** How the sheet prints each band, rates 5 down to 1. */
  labels: [string, string, string, string, string];
}

export const QUALITY_BANDS: RateBands = {
  direction: "higher",
  goal: 98,
  cuts: [100, 99, 98, 96],
  labels: [">= 100%", "99%-99.99%", "98%-98.99%", "96%-97.99%", "<= 95.99%"],
};

/** Six-month count. The sheet's rate 2 reads "5.00-7.00" and rate 1 ">= 7.00"; a count of 7 rates 1. */
export const CRITICAL_ERROR_BANDS: RateBands = {
  direction: "lower",
  goal: 2,
  cuts: [0, 1, 4, 6],
  labels: ["0", "1", "2-4", "5-6", ">= 7"],
};

/** Six-month count. */
export const STANDARD_ERROR_BANDS: RateBands = {
  direction: "lower",
  goal: 3,
  cuts: [0, 2, 8, 14],
  labels: ["0", "1-2", "3-8", "9-14", ">= 15"],
};

export const IRE_BANDS: RateBands = {
  direction: "lower",
  goal: 1,
  cuts: [0, null, 1, 2],
  labels: ["0", "--", "1", "2", ">= 3"],
};

export const PKT_BANDS: RateBands = {
  direction: "higher",
  goal: 80,
  cuts: [100, 90, 80, 70],
  labels: [">= 100%", "90%-99.99%", "80%-89.99%", "70%-79.99%", "<= 69.99%"],
};

export const ATTENDANCE_BANDS: RateBands = {
  direction: "higher",
  goal: 95,
  cuts: [100, 97, 95, 93],
  labels: [">= 100%", "97%-99.99%", "95%-96.99%", "93%-94.99%", "<= 92.99%"],
};

export const LH_UTILIZATION_BANDS: RateBands = {
  direction: "higher",
  goal: 71.42,
  cuts: [71.42, null, null, 65],
  labels: [">= 71.42%", "--", "--", "65%-71.41%", "<= 64.99%"],
};

export const NPS_BANDS: RateBands = {
  direction: "higher",
  goal: 70,
  cuts: [87, 78, 70, 62],
  labels: [">= 87", "78-86.99", "70-77.99", "62-69.99", "<= 61.99"],
};

/** The rate a value earns on a band table: the first cut it clears, from 5 down, else 1. */
export function rateOn(bands: RateBands, value: number): Rate {
  const rates: Rate[] = [5, 4, 3, 2];
  for (let i = 0; i < rates.length; i += 1) {
    const cut = bands.cuts[i];
    if (cut === null) continue;
    if (bands.direction === "higher" ? value >= cut : value <= cut) return rates[i];
  }
  return 1;
}
