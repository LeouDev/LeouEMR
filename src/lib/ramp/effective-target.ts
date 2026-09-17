/**
 * The target a person was held to over a span of weeks, for a measure
 * summed across those weeks.
 *
 * A ramping employee's target moves week to week (see engine.ts), so a
 * period's summed cases and hours have to be judged against one number
 * that stands in for all of them: the plain average of the weekly targets
 * — the workbook's own rule — over the weeks that were actually worked.
 * Averaging every calendar week of the period was wrong in a running
 * month: the weeks not yet worked, with their later and tighter stages
 * (or the steady target once the ramp is over), pulled the average away
 * from what the worked weeks were held to, and an agent rated 3.6–5.0
 * week by week read as 1.0 for the month. At month end, with every week
 * worked, the two are the same number. Nothing worked in the span means
 * the steady target, as for anyone not ramping.
 *
 * Each worked week counts once, whatever its volume — the owner's call
 * over an hours- or cases-weighted mean, so the figure matches the
 * workbook's average of weekly targets.
 */

export interface WeekVolume {
  /** The reporting week's first day, `YYYY-MM-DD`. */
  weekStart: string;
  hours: number;
  cases: number;
}

export interface EffectiveTarget {
  target: number;
  /** Whether a ramp-stage target applied to any week that counted. */
  ramping: boolean;
}

/** A week counts when anything at all was worked in it. */
function worked(week: WeekVolume): boolean {
  return week.hours > 0 || week.cases > 0;
}

export function effectiveTarget(
  weeks: readonly WeekVolume[],
  /** The ramp-stage target for a week, or undefined when the steady target applies. */
  overrideFor: (weekStart: string) => number | undefined,
  steady: number,
): EffectiveTarget {
  let sum = 0;
  let count = 0;
  let ramping = false;
  for (const week of weeks) {
    if (!worked(week)) continue;
    const override = overrideFor(week.weekStart);
    if (override !== undefined) ramping = true;
    sum += override ?? steady;
    count += 1;
  }
  if (count === 0) return { target: steady, ramping: false };
  return { target: sum / count, ramping };
}
