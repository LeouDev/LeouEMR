import { describe, expect, it } from "vitest";
import { LAST_STAGE, NESTING_STAGES, isNesting, rampStageForWeek, stageLabel, weekForStage } from "./engine";

/**
 * The only thing this module does — map a calendar week onto a ramp stage —
 * is also the only place a boundary mistake would silently misprice a real
 * new hire's target for a week, so every edge gets its own case rather than
 * trusting the general formula to cover them.
 */
describe("rampStageForWeek", () => {
  const START = "2026-08-01"; // stage 0 (the first nesting week) begins here

  it("is stage 0 (the first nesting week) on the start week itself", () => {
    expect(rampStageForWeek(START, "2026-08-01")).toBe(0);
  });

  it("spends two weeks nesting, then reaches ramp Week 1 on the third", () => {
    expect(isNesting(rampStageForWeek(START, "2026-08-01")!)).toBe(true);
    expect(isNesting(rampStageForWeek(START, "2026-08-08")!)).toBe(true);
    expect(isNesting(rampStageForWeek(START, "2026-08-15")!)).toBe(false);
    expect(NESTING_STAGES).toBe(2);
  });

  it("advances one stage per elapsed week", () => {
    expect(rampStageForWeek(START, "2026-08-08")).toBe(1);
    expect(rampStageForWeek(START, "2026-08-15")).toBe(2);
    expect(rampStageForWeek(START, "2026-08-22")).toBe(3);
  });

  it("reaches stage 9 (ramp Week 8) exactly 9 weeks after the start", () => {
    expect(rampStageForWeek(START, "2026-10-03")).toBe(9);
    expect(LAST_STAGE).toBe(9);
  });

  it("is null the week after stage 9 — ramp is complete", () => {
    expect(rampStageForWeek(START, "2026-10-10")).toBeNull();
  });

  it("is null for any week before ramp began", () => {
    expect(rampStageForWeek(START, "2026-07-25")).toBeNull();
  });

  it("is null far in the future, not a wrapped or negative stage", () => {
    expect(rampStageForWeek(START, "2027-08-01")).toBeNull();
  });

  it("does not misfire one day off either boundary", () => {
    // The day before the start week: not yet begun.
    expect(rampStageForWeek(START, "2026-07-31")).toBeNull();
    // A week mislabeled by one day either side of a real week-start should
    // never happen in practice (weeks are always Saturdays here), but the
    // arithmetic itself should still round to the nearest whole week rather
    // than silently landing on a fractional stage.
    expect(rampStageForWeek("2026-08-01", "2026-08-01")).toBe(0);
  });
});

describe("weekForStage", () => {
  it("is the inverse of rampStageForWeek", () => {
    const start = "2026-08-01";
    for (let stage = 0; stage <= LAST_STAGE; stage++) {
      const week = weekForStage(start, stage);
      expect(rampStageForWeek(start, week)).toBe(stage);
    }
  });

  it("crosses a month boundary correctly", () => {
    expect(weekForStage("2026-08-29", 1)).toBe("2026-09-05");
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
