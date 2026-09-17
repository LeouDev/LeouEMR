/**
 * Reporting periods.
 *
 * Any period is expressed as an inclusive date range, so a single
 * aggregation path serves day, week, month, quarter and year. The
 * action-item engine is unaffected — it remains weekly, because the
 * 4-week sustained rule is defined in weeks.
 */

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export const GRANULARITIES: Granularity[] = ["day", "week", "month", "quarter", "year"];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

export interface Period {
  granularity: Granularity;
  /** Inclusive ISO dates. */
  start: string;
  end: string;
  label: string;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Reporting weeks run Sunday to Saturday — the operation's own week — from
 * this Sunday on. Before it they ran Saturday to Friday, the span the
 * source workbook's "WE <Friday>" labels describe, and the weeks already
 * reported that way are left as they were.
 *
 * The two regimes meet at one extended week: the last Saturday-to-Friday
 * week (Sat 23 May 2026) runs eight days, to Sat 30 May, so that no day
 * falls between the regimes and no week starts on the day the cut-over
 * takes effect. The week list steps from each week's end, so the extra day
 * costs nothing there; the ramp engine walks the same boundaries.
 *
 * `reportingWeekStart` in week-sql.ts is the SQL form of this rule for
 * queries that bucket daily facts by week; the two must agree.
 */
export const WEEK_CUTOVER = "2026-05-31";
export const LAST_LEGACY_WEEK_START = "2026-05-23";

/** The day before the cut-over — the extended final legacy week's end. */
const LAST_LEGACY_WEEK_END = "2026-05-30";

/** Inclusive start and end of the reporting week containing `date`. */
export function weekContaining(date: string): { start: string; end: string } {
  if (date >= WEEK_CUTOVER) {
    const d = utc(date);
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - d.getUTCDay()); // 0 = Sunday
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: iso(start), end: iso(end) };
  }
  if (date >= LAST_LEGACY_WEEK_START) {
    return { start: LAST_LEGACY_WEEK_START, end: LAST_LEGACY_WEEK_END };
  }
  // Legacy: the source weeks ended on Friday, so they began on the preceding Saturday.
  const d = utc(date);
  const start = new Date(d);
  start.setUTCDate(start.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: iso(start), end: iso(end) };
}

/**
 * The period containing a given date.
 *
 * Weeks follow the reporting-week rule above rather than the ISO Monday
 * week, which would silently split every imported week across two
 * reporting periods.
 */
export function periodContaining(granularity: Granularity, date: string): Period {
  const d = utc(date);

  switch (granularity) {
    case "day":
      return { granularity, start: date, end: date, label: formatDay(d) };

    case "week": {
      const { start, end } = weekContaining(date);
      return { granularity, start, end, label: formatRange(utc(start), utc(end)) };
    }

    case "month": {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return {
        granularity,
        start: iso(start),
        end: iso(end),
        label: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      };
    }

    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3);
      const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
      return {
        granularity,
        start: iso(start),
        end: iso(end),
        label: `Q${q + 1} ${d.getUTCFullYear()}`,
      };
    }

    case "year": {
      const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), 11, 31));
      return { granularity, start: iso(start), end: iso(end), label: String(d.getUTCFullYear()) };
    }
  }
}

/** Every period of the given granularity covering the data's date span, newest first. */
export function periodsBetween(granularity: Granularity, first: string, last: string): Period[] {
  const periods: Period[] = [];
  const seen = new Set<string>();

  let cursor = utc(first);
  const end = utc(last);

  while (cursor <= end) {
    const period = periodContaining(granularity, iso(cursor));
    if (!seen.has(period.start)) {
      seen.add(period.start);
      periods.push(period);
    }
    // Step to the day after this period ends, so no period is skipped.
    cursor = utc(period.end);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return periods.reverse();
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRange(start: Date, end: Date): string {
  const fmt = (x: Date) =>
    x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function parseGranularity(value: string | undefined): Granularity {
  return GRANULARITIES.includes(value as Granularity) ? (value as Granularity) : "week";
}

/**
 * The period immediately before this one, at the same granularity.
 *
 * Derived by stepping one day back from the start and asking which period
 * contains it, so month lengths, quarter boundaries and leap years are
 * handled by the same logic that built the original rather than by arithmetic
 * that has to special-case each granularity.
 */
export function previousPeriod(period: Period): Period {
  const dayBefore = new Date(`${period.start}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return periodContaining(period.granularity, dayBefore.toISOString().slice(0, 10));
}
