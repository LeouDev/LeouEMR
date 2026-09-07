import { describe, expect, it } from "vitest";
import { MIN_PRODUCTION_HOURS, eligibilityFor } from "./eligibility";
import type { Period } from "./period";

const month = (start: string, end: string): Period => ({
  granularity: "month",
  start,
  end,
  label: start,
});

const JUNE = month("2026-06-01", "2026-06-30");
const JULY = month("2026-07-01", "2026-07-31");
const AUGUST = month("2026-08-01", "2026-08-31");
const SEPARATED_ON = "2026-07-22";

describe("eligibilityFor", () => {
  it("leaves months that ended before the separation untouched", () => {
    // Hours are irrelevant here: a past month must report the same figure it
    // reported before anyone resigned.
    expect(eligibilityFor(JUNE, SEPARATED_ON, 0)).toBe(true);
    expect(eligibilityFor(JUNE, SEPARATED_ON, 200)).toBe(true);
  });

  it("excludes months that start after the separation", () => {
    expect(eligibilityFor(AUGUST, SEPARATED_ON, 0)).toBe(false);
    expect(eligibilityFor(AUGUST, SEPARATED_ON, 500)).toBe(false);
  });

  it("includes the separation month when they worked more than the threshold", () => {
    expect(eligibilityFor(JULY, SEPARATED_ON, 41.9)).toBe(true);
  });

  it("excludes the separation month when they did not", () => {
    expect(eligibilityFor(JULY, SEPARATED_ON, 12)).toBe(false);
  });

  it("treats the threshold as strictly greater than", () => {
    expect(eligibilityFor(JULY, SEPARATED_ON, MIN_PRODUCTION_HOURS)).toBe(false);
    expect(eligibilityFor(JULY, SEPARATED_ON, MIN_PRODUCTION_HOURS + 0.1)).toBe(true);
  });

  it("handles a separation on the first day of the period", () => {
    // Nothing worked before the 1st, so nothing to count.
    expect(eligibilityFor(JULY, "2026-07-01", 0)).toBe(false);
  });

  it("handles a separation on the last day of the period", () => {
    expect(eligibilityFor(JULY, "2026-07-31", 150)).toBe(true);
  });

  it("works at week granularity too", () => {
    const week: Period = {
      granularity: "week",
      start: "2026-07-18",
      end: "2026-07-24",
      label: "Jul 18 – Jul 24",
    };
    const before: Period = { ...week, start: "2026-07-11", end: "2026-07-17" };
    const after: Period = { ...week, start: "2026-07-25", end: "2026-07-31" };
    expect(eligibilityFor(before, SEPARATED_ON, 0)).toBe(true);
    expect(eligibilityFor(after, SEPARATED_ON, 0)).toBe(false);
    expect(eligibilityFor(week, SEPARATED_ON, 31)).toBe(true);
  });
});
