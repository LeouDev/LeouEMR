import { describe, expect, it } from "vitest";
import { LAST_STAGE, NESTING_STAGES, isNesting, rampStageForWeek, stageLabel, weekForStage } from "./engine";

/**
 * The only thing this module does — map a calendar week onto a ramp stage —
 * is also the only place a boundary mistake would silently misprice a real
 * new hire's target for a week, so every edge gets its own case rather than
 * trusting the general formula to cover them.
 */
describe("rampStageForWeek", () => {
  const START = "2026-08-02"; // a Sunday: stage 0 (the first nesting week) begins here

  it("is stage 0 (the first nesting week) on the start week itself", () => {
    expect(rampStageForWeek(START, "2026-08-02")).toBe(0);
  });

  it("spends two weeks nesting, then reaches ramp Week 1 on the third", () => {
    expect(isNesting(rampStageForWeek(START, "2026-08-02")!)).toBe(true);
    expect(isNesting(rampStageForWeek(START, "2026-08-09")!)).toBe(true);
    expect(isNesting(rampStageForWeek(START, "2026-08-16")!)).toBe(false);
    expect(NESTING_STAGES).toBe(2);
  });

  it("advances one stage per elapsed week", () => {
    expect(rampStageForWeek(START, "2026-08-09")).toBe(1);
    expect(rampStageForWeek(START, "2026-08-16")).toBe(2);
    expect(rampStageForWeek(START, "2026-08-23")).toBe(3);
  });

  it("reaches stage 9 (ramp Week 8) exactly 9 weeks after the start", () => {
    expect(rampStageForWeek(START, "2026-10-04")).toBe(9);
    expect(LAST_STAGE).toBe(9);
  });

  it("is null the week after stage 9 — ramp is complete", () => {
    expect(rampStageForWeek(START, "2026-10-11")).toBeNull();
  });

  it("is null for any week before ramp began", () => {
    expect(rampStageForWeek(START, "2026-07-26")).toBeNull();
  });

  it("is null far in the future, not a wrapped or negative stage", () => {
    expect(rampStageForWeek(START, "2027-08-01")).toBeNull();
  });

  it("does not misfire one day off either boundary", () => {
    // The day before the start week: not yet begun.
    expect(rampStageForWeek(START, "2026-08-01")).toBeNull();
    // Any day inside a week names that week — an as-of date mid-week and
    // the stored week start resolve to the same stage.
    expect(rampStageForWeek(START, "2026-08-05")).toBe(0);
    expect(rampStageForWeek(START, "2026-08-08")).toBe(0);
    expect(rampStageForWeek(START, "2026-10-10")).toBe(9);
  });

  it("walks the reporting weeks across the Sunday cut-over", () => {
    // A ramp that began in the last Saturday-to-Friday week: stage 1 is the
    // first Sunday-to-Saturday week, not the Saturday seven days on.
    const legacyStart = "2026-05-23";
    expect(rampStageForWeek(legacyStart, "2026-05-23")).toBe(0);
    expect(rampStageForWeek(legacyStart, "2026-05-30")).toBe(0);
    expect(rampStageForWeek(legacyStart, "2026-05-31")).toBe(1);
    expect(rampStageForWeek(legacyStart, "2026-06-07")).toBe(2);
    expect(rampStageForWeek(legacyStart, "2026-07-26")).toBe(9);
    expect(rampStageForWeek(legacyStart, "2026-08-02")).toBeNull();
  });
});

describe("weekForStage", () => {
  it("is the inverse of rampStageForWeek", () => {
    for (const start of ["2026-08-02", "2026-05-23", "2026-05-09"]) {
      for (let stage = 0; stage <= LAST_STAGE; stage++) {
        const week = weekForStage(start, stage);
        expect(rampStageForWeek(start, week)).toBe(stage);
      }
    }
  });

  it("crosses a month boundary correctly", () => {
    expect(weekForStage("2026-08-30", 1)).toBe("2026-09-06");
  });

  it("lands on Sundays after the cut-over even for a ramp that began before it", () => {
    expect(weekForStage("2026-05-23", 1)).toBe("2026-05-31");
    expect(weekForStage("2026-05-23", 9)).toBe("2026-07-26");
    // Before the cut-over the weeks were Saturdays, and still are.
    expect(weekForStage("2026-05-09", 1)).toBe("2026-05-16");
    expect(weekForStage("2026-05-09", 2)).toBe("2026-05-23");
    expect(weekForStage("2026-05-09", 3)).toBe("2026-05-31");
  });

  it("names the week containing a mid-week start date", () => {
    expect(weekForStage("2026-09-01", 0)).toBe("2026-08-30");
  });
});

describe("stageLabel", () => {
  it("names the two nesting weeks, not Week 0", () => {
    expect(stageLabel(0)).toBe("Nesting 1");
    expect(stageLabel(1)).toBe("Nesting 2");
  });

  it("names the ramp weeks Week 1 through Week 8 after them", () => {
    expect(stageLabel(2)).toBe("Week 1");
    expect(stageLabel(9)).toBe("Week 8");
  });
});
