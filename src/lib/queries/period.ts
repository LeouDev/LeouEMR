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
 * The period containing a given date.
 *
 * Weeks run Saturday to Friday, matching the source data's "WE" labels —
 * using an ISO Monday week here would silently split every week in the
 * imported data across two reporting periods.
 */
export function periodContaining(granularity: Granularity, date: string): Period {
  const d = utc(date);

  switch (granularity) {
    case "day":
      return { granularity, start: date, end: date, label: formatDay(d) };

    case "week": {
      // Source weeks end on Friday, so they start on the preceding Saturday.
      const day = d.getUTCDay(); // 0 = Sunday
      const daysSinceSaturday = (day + 1) % 7;
      const start = new Date(d);
      start.setUTCDate(start.getUTCDate() - daysSinceSaturday);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      return { granularity, start: iso(start), end: iso(end), label: formatRange(start, end) };
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
