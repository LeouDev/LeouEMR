import { describe, expect, it } from "vitest";
import { MIN_PRODUCTION_HOURS, eligibilityFor, hoursBeforeCutoff, mergeSeparations } from "./eligibility";
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

describe("hoursBeforeCutoff", () => {
  it("sums only the rows before that employee's own cutoff date", () => {
    const result = hoursBeforeCutoff(
      [
        { employeeId: "a", factDate: "2026-07-10", hours: 8 },
        { employeeId: "a", factDate: "2026-07-21", hours: 8 },
        // On or after the cutoff — must not count.
        { employeeId: "a", factDate: "2026-07-22", hours: 100 },
        { employeeId: "a", factDate: "2026-07-25", hours: 100 },
      ],
      new Map([["a", "2026-07-22"]]),
    );
    expect(result.get("a")).toBe(16);
  });

  it("keeps each employee's total separate, even with different cutoffs", () => {
    const result = hoursBeforeCutoff(
      [
        { employeeId: "a", factDate: "2026-07-10", hours: 8 },
        { employeeId: "b", factDate: "2026-07-10", hours: 5 },
        { employeeId: "b", factDate: "2026-07-15", hours: 5 },
      ],
      new Map([
        ["a", "2026-07-22"],
        ["b", "2026-07-12"],
      ]),
    );
    expect(result.get("a")).toBe(8);
    expect(result.get("b")).toBe(5);
  });

  it("ignores rows for an employee with no cutoff at all", () => {
    const result = hoursBeforeCutoff(
      [{ employeeId: "unrelated", factDate: "2026-07-10", hours: 8 }],
      new Map([["a", "2026-07-22"]]),
    );
    expect(result.has("unrelated")).toBe(false);
  });

  it("returns an empty map for no rows", () => {
    const result = hoursBeforeCutoff([], new Map([["a", "2026-07-22"]]));
    expect(result.size).toBe(0);
  });
});

describe("mergeSeparations", () => {
  it("takes a closed newest interval as a separation on its last day", () => {
    const dates = mergeSeparations([], [{ employeeId: "a", effectiveTo: "2026-08-31" }]);
    expect(dates.get("a")).toBe("2026-08-31");
  });

  it("reads nothing into an open newest interval", () => {
    const dates = mergeSeparations([], [{ employeeId: "a", effectiveTo: null }]);
    expect(dates.has("a")).toBe(false);
  });

  it("keeps the earlier of an EWS separation and a masterlist closure", () => {
    const dates = mergeSeparations(
      [
        { employeeId: "a", on: "2026-08-12" },
        { employeeId: "b", on: "2026-09-03" },
      ],
      [
        { employeeId: "a", effectiveTo: "2026-08-31" },
        { employeeId: "b", effectiveTo: "2026-08-31" },
        { employeeId: "c", effectiveTo: null },
      ],
    );
    expect(dates.get("a")).toBe("2026-08-12");
    expect(dates.get("b")).toBe("2026-08-31");
    expect(dates.has("c")).toBe(false);
  });

  it("keeps a tagged separation for someone with no assignment history", () => {
    const dates = mergeSeparations([{ employeeId: "a", on: "2026-07-22" }], []);
    expect(dates.get("a")).toBe("2026-07-22");
  });
});
