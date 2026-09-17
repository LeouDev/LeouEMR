/**
 * The target a person was held to over a span of weeks, for a measure
 * summed across those weeks.
 *
 * A ramping employee's target moves week to week (see engine.ts), so a
 * period's summed cases and hours have to be judged against one number
 * that stands in for all of them. A plain average over the period's
 * calendar weeks was wrong in a running month: the weeks not yet worked —
 * later, tighter stages — pulled the target away from what the worked
 * weeks were actually held to, and a week on leave counted the same as a
 * full one, so an agent rated 3.6–5.0 week by week read as 1.0 for the
 * month. Each week's target is weighted by what was worked in it instead:
 * hours for a per-hour rate (CPH, case rate), cases for a per-case time
 * (AHT) — the weighting under which the summed measure's ratio equals
 * the worked weeks' ratios combined. Nothing worked in the span means the
 * steady target, as for anyone not ramping.
 */

export interface WeekVolume {
  /** The reporting week's start (Saturday), `YYYY-MM-DD`. */
  weekStart: string;
  hours: number;
  cases: number;
}

export interface EffectiveTarget {
  target: number;
  /** Whether a ramp-stage target applied to any week that counted. */
  ramping: boolean;
}

export function effectiveTarget(
  weeks: readonly WeekVolume[],
  /** The ramp-stage target for a week, or undefined when the steady target applies. */
  overrideFor: (weekStart: string) => number | undefined,
  steady: number,
  lowerIsBetter: boolean,
): EffectiveTarget {
  let weighted = 0;
  let totalWeight = 0;
  let ramping = false;
  for (const week of weeks) {
    const weight = lowerIsBetter ? week.cases : week.hours;
    if (!(weight > 0)) continue;
    const override = overrideFor(week.weekStart);
    if (override !== undefined) ramping = true;
    weighted += weight * (override ?? steady);
    totalWeight += weight;
  }
  if (totalWeight <= 0) return { target: steady, ramping: false };
  return { target: weighted / totalWeight, ramping };
}
