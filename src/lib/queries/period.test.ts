import { describe, expect, it } from "vitest";
import { periodContaining, periodsBetween } from "./period";

describe("periodContaining", () => {
  it("returns the single day for day granularity", () => {
    expect(periodContaining("day", "2026-08-12")).toMatchObject({
      start: "2026-08-12",
      end: "2026-08-12",
    });
  });

  it("uses Saturday-to-Friday weeks, matching the source data's WE labels", () => {
    // The source labels this week "WE 08/14/26" — Sat Aug 8 to Fri Aug 14.
    for (const day of ["2026-08-08", "2026-08-11", "2026-08-14"]) {
      expect(periodContaining("week", day)).toMatchObject({
        start: "2026-08-08",
        end: "2026-08-14",
      });
    }
  });

  it("puts the day after a week's end into the next week", () => {
    expect(periodContaining("week", "2026-08-15")).toMatchObject({
      start: "2026-08-15",
      end: "2026-08-21",
    });
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
    const weeks = periodsBetween("week", "2026-08-01", "2026-08-31").reverse();
    expect(weeks[0].start).toBe("2026-08-01");

    for (let i = 1; i < weeks.length; i++) {
      const previousEnd = new Date(`${weeks[i - 1].end}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      expect(weeks[i].start).toBe(previousEnd.toISOString().slice(0, 10));
    }
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
