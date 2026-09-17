import { describe, expect, it } from "vitest";
import {
  GRANULARITIES,
  LAST_LEGACY_WEEK_START,
  WEEK_CUTOVER,
  periodContaining,
  periodsBetween,
  previousPeriod,
  weekContaining,
  type Granularity,
} from "./period";

describe("periodContaining", () => {
  it("returns the single day for day granularity", () => {
    expect(periodContaining("day", "2026-08-12")).toMatchObject({
      start: "2026-08-12",
      end: "2026-08-12",
    });
  });

  it("uses Sunday-to-Saturday weeks from the cut-over on", () => {
    expect(WEEK_CUTOVER).toBe("2026-05-31");
    // Sun Aug 9 to Sat Aug 15.
    for (const day of ["2026-08-09", "2026-08-12", "2026-08-15"]) {
      expect(periodContaining("week", day)).toMatchObject({
        start: "2026-08-09",
        end: "2026-08-15",
      });
    }
  });

  it("puts the day after a week's end into the next week", () => {
    expect(periodContaining("week", "2026-08-16")).toMatchObject({
      start: "2026-08-16",
      end: "2026-08-22",
    });
  });

  it("starts the first Sunday-to-Saturday week on the cut-over day itself", () => {
    expect(periodContaining("week", "2026-05-31")).toMatchObject({
      start: "2026-05-31",
      end: "2026-06-06",
    });
    expect(periodContaining("week", "2026-06-06")).toMatchObject({
      start: "2026-05-31",
      end: "2026-06-06",
    });
  });

  it("keeps Saturday-to-Friday weeks before the cut-over, as the data was reported", () => {
    // "WE 05/15/26" — Sat May 9 to Fri May 15.
    for (const day of ["2026-05-09", "2026-05-12", "2026-05-15"]) {
      expect(periodContaining("week", day)).toMatchObject({
        start: "2026-05-09",
        end: "2026-05-15",
      });
    }
    expect(periodContaining("week", "2026-05-16")).toMatchObject({
      start: "2026-05-16",
      end: "2026-05-22",
    });
  });

  it("extends the last legacy week by a day so the regimes meet with no gap", () => {
    // Sat May 23 to Sat May 30: the Friday-ending week plus the Saturday
    // that would otherwise begin a week the cut-over cuts off after one day.
    for (const day of ["2026-05-23", "2026-05-29", "2026-05-30"]) {
      expect(periodContaining("week", day)).toMatchObject({
        start: LAST_LEGACY_WEEK_START,
        end: "2026-05-30",
      });
    }
    expect(weekContaining("2026-05-30").start).toBe("2026-05-23");
  });

  it("covers whole calendar months including leap years", () => {
    expect(periodContaining("month", "2026-08-12")).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(periodContaining("month", "2024-02-10")).toMatchObject({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("covers calendar quarters", () => {
    expect(periodContaining("quarter", "2026-08-12")).toMatchObject({
      start: "2026-07-01",
      end: "2026-09-30",
      label: "Q3 2026",
    });
    expect(periodContaining("quarter", "2026-01-05")).toMatchObject({
      start: "2026-01-01",
      end: "2026-03-31",
      label: "Q1 2026",
    });
  });

  it("covers calendar years", () => {
    expect(periodContaining("year", "2026-08-12")).toMatchObject({
      start: "2026-01-01",
      end: "2026-12-31",
      label: "2026",
    });
  });
});

describe("periodsBetween", () => {
  it("enumerates every week across the span without gaps or repeats", () => {
    const weeks = periodsBetween("week", "2026-08-02", "2026-08-31").reverse();
    expect(weeks[0].start).toBe("2026-08-02");

    for (let i = 1; i < weeks.length; i++) {
      const previousEnd = new Date(`${weeks[i - 1].end}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      expect(weeks[i].start).toBe(previousEnd.toISOString().slice(0, 10));
    }
  });

  it("crosses the cut-over with one extended week and no gap or overlap", () => {
    const weeks = periodsBetween("week", "2026-05-10", "2026-06-13").reverse();
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ["2026-05-09", "2026-05-15"],
      ["2026-05-16", "2026-05-22"],
      ["2026-05-23", "2026-05-30"],
      ["2026-05-31", "2026-06-06"],
      ["2026-06-07", "2026-06-13"],
    ]);
  });

  it("returns one month for a single month's span", () => {
    expect(periodsBetween("month", "2026-08-01", "2026-08-31")).toHaveLength(1);
  });

  it("returns periods newest first", () => {
    const months = periodsBetween("month", "2026-06-01", "2026-08-31");
    expect(months.map((m) => m.start)).toEqual(["2026-08-01", "2026-07-01", "2026-06-01"]);
  });

  it("covers a span crossing a year boundary", () => {
    const quarters = periodsBetween("quarter", "2025-11-15", "2026-02-10");
    expect(quarters.map((q) => q.label)).toEqual(["Q1 2026", "Q4 2025"]);
  });

  it("returns a single day period for a one-day span", () => {
    expect(periodsBetween("day", "2026-08-12", "2026-08-12")).toHaveLength(1);
  });
});

describe("previousPeriod", () => {
  const prev = (granularity: Granularity, date: string) =>
    previousPeriod(periodContaining(granularity, date));

  it("steps back a day", () => {
    expect(prev("day", "2026-09-01").start).toBe("2026-08-31");
  });

  it("steps back a week, keeping the Sunday start", () => {
    const p = prev("week", "2026-09-02");
    expect(p.start).toBe("2026-08-23");
    expect(p.end).toBe("2026-08-29");
  });

  it("steps back across the cut-over into the extended legacy week", () => {
    const p = prev("week", "2026-06-03");
    expect(p.start).toBe("2026-05-23");
    expect(p.end).toBe("2026-05-30");
    const q = previousPeriod(p);
    expect(q.start).toBe("2026-05-16");
    expect(q.end).toBe("2026-05-22");
  });

  it("steps back a month across a year boundary", () => {
    const p = prev("month", "2026-01-15");
    expect(p.start).toBe("2025-12-01");
    expect(p.end).toBe("2025-12-31");
  });

  it("handles months of different lengths", () => {
    // March back to February, which is shorter — arithmetic on "30 days ago"
    // would land in the wrong month here.
    const p = prev("month", "2026-03-31");
    expect(p.start).toBe("2026-02-01");
    expect(p.end).toBe("2026-02-28");
  });

  it("steps back a quarter", () => {
    const p = prev("quarter", "2026-04-15");
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-03-31");
  });

  it("steps back a year", () => {
    const p = prev("year", "2026-06-01");
    expect(p.start).toBe("2025-01-01");
    expect(p.end).toBe("2025-12-31");
  });

  it("keeps the granularity it was given", () => {
    for (const g of GRANULARITIES) {
      expect(prev(g, "2026-05-15").granularity).toBe(g);
    }
  });
});
