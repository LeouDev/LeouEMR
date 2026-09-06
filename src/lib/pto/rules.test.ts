import { describe, expect, it } from "vitest";
import {
  canCancel,
  canDecide,
  countDays,
  daysIn,
  overlaps,
  validateRequest,
  type PtoStatus,
} from "./rules";

describe("countDays", () => {
  it("counts both ends, so one day is one", () => {
    expect(countDays({ startDate: "2026-08-24", endDate: "2026-08-24" })).toBe(1);
  });

  it("counts a working week as five", () => {
    expect(countDays({ startDate: "2026-08-24", endDate: "2026-08-28" })).toBe(5);
  });

  it("counts across a month boundary", () => {
    expect(countDays({ startDate: "2026-08-30", endDate: "2026-09-02" })).toBe(4);
  });

  it("is unaffected by daylight saving, since days are plain dates", () => {
    // A naive local-time subtraction would give 30 or 32 hours here.
    expect(countDays({ startDate: "2026-03-28", endDate: "2026-03-30" })).toBe(3);
  });
});

describe("overlaps", () => {
  const week = { startDate: "2026-08-24", endDate: "2026-08-28" };

  it("detects a shared day at either edge", () => {
    expect(overlaps(week, { startDate: "2026-08-28", endDate: "2026-08-30" })).toBe(true);
    expect(overlaps(week, { startDate: "2026-08-20", endDate: "2026-08-24" })).toBe(true);
  });

  it("is false for ranges that merely touch without sharing a day", () => {
    expect(overlaps(week, { startDate: "2026-08-29", endDate: "2026-08-31" })).toBe(false);
    expect(overlaps(week, { startDate: "2026-08-20", endDate: "2026-08-23" })).toBe(false);
  });

  it("detects full containment either way round", () => {
    expect(overlaps(week, { startDate: "2026-08-25", endDate: "2026-08-26" })).toBe(true);
    expect(overlaps({ startDate: "2026-08-25", endDate: "2026-08-26" }, week)).toBe(true);
  });
});

describe("validateRequest", () => {
  const none: Array<{ startDate: string; endDate: string; status: PtoStatus }> = [];

  it("accepts a well-formed request", () => {
    expect(validateRequest({ startDate: "2026-08-24", endDate: "2026-08-28" }, none)).toBeNull();
  });

  it("rejects an end date before the start", () => {
    expect(validateRequest({ startDate: "2026-08-28", endDate: "2026-08-24" }, none)).toBe(
      "end-before-start",
    );
  });

  it("rejects missing or malformed dates", () => {
    expect(validateRequest({ startDate: "", endDate: "2026-08-24" }, none)).toBe("invalid-dates");
    expect(validateRequest({ startDate: "24/08/2026", endDate: "2026-08-24" }, none)).toBe(
      "invalid-dates",
    );
  });

  it("rejects a request longer than the cap", () => {
    expect(validateRequest({ startDate: "2026-01-01", endDate: "2026-03-01" }, none)).toBe(
      "too-long",
    );
  });

  it("rejects an overlap with a pending or approved request", () => {
    for (const status of ["pending", "approved"] as PtoStatus[]) {
      expect(
        validateRequest({ startDate: "2026-08-26", endDate: "2026-08-27" }, [
          { startDate: "2026-08-24", endDate: "2026-08-28", status },
        ]),
      ).toBe("overlaps-existing");
    }
  });

  it("ignores denied and cancelled requests when checking overlap", () => {
    // Those days were given back, so they are free to request again.
    for (const status of ["denied", "cancelled"] as PtoStatus[]) {
      expect(
        validateRequest({ startDate: "2026-08-26", endDate: "2026-08-27" }, [
          { startDate: "2026-08-24", endDate: "2026-08-28", status },
        ]),
      ).toBeNull();
    }
  });

  it("allows a request in the past, since sick leave is filed after the fact", () => {
    expect(validateRequest({ startDate: "2020-01-06", endDate: "2020-01-07" }, none)).toBeNull();
  });
});

describe("transitions", () => {
  it("only allows a decision while pending", () => {
    expect(canDecide("pending")).toBe(true);
    for (const s of ["approved", "denied", "cancelled"] as PtoStatus[]) {
      expect(canDecide(s)).toBe(false);
    }
  });

  it("allows withdrawing a pending or approved request, but not a decided-against one", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("denied")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});

describe("daysIn", () => {
  it("lists every inclusive day", () => {
    expect(daysIn({ startDate: "2026-08-30", endDate: "2026-09-02" })).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("returns the single day for a one-day request", () => {
    expect(daysIn({ startDate: "2026-08-24", endDate: "2026-08-24" })).toEqual(["2026-08-24"]);
  });
});

