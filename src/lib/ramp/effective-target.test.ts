import { describe, expect, it } from "vitest";
import { effectiveTarget, type WeekVolume } from "./effective-target";

/**
 * The monthly PAR for a ramping agent was a plain average of the month's
 * calendar weeks' targets, unworked weeks included; these pin the
 * work-weighted target that replaced it.
 */
const week = (weekStart: string, hours: number, cases: number): WeekVolume => ({ weekStart, hours, cases });
const STAGES: Record<string, number> = { "2026-08-29": 1100, "2026-09-05": 1000, "2026-09-12": 900, "2026-09-19": 800, "2026-09-26": 700 };
const stage = (w: string) => STAGES[w];

describe("effectiveTarget", () => {
  it("is the steady target for someone not ramping, whatever they worked", () => {
    const weeks = [week("2026-09-05", 40, 200), week("2026-09-12", 40, 210)];
    expect(effectiveTarget(weeks, () => undefined, 500, true)).toEqual({ target: 500, ramping: false });
    expect(effectiveTarget(weeks, () => undefined, 11, false)).toEqual({ target: 11, ramping: false });
  });

  it("counts only the weeks worked in a running month — the later, tighter stages wait their turn", () => {
    // Three weeks in, two still to come: the old plain average of all five
    // stages (900) would have judged 1000-second handle times as failing.
    const weeks = [
      week("2026-08-29", 40, 100),
      week("2026-09-05", 40, 100),
      week("2026-09-12", 40, 100),
      week("2026-09-19", 0, 0),
      week("2026-09-26", 0, 0),
    ];
    expect(effectiveTarget(weeks, stage, 500, true)).toEqual({ target: 1000, ramping: true });
  });

  it("weights a per-case time by cases and a per-hour rate by hours", () => {
    const weeks = [week("2026-08-29", 10, 100), week("2026-09-05", 30, 300)];
    // AHT: (100·1100 + 300·1000) / 400
    expect(effectiveTarget(weeks, stage, 500, true).target).toBeCloseTo(1025);
    // CPH: (10·1100 + 30·1000) / 40
    expect(effectiveTarget(weeks, stage, 11, false).target).toBeCloseTo(1025);
  });

  it("lets the steady target take over for the weeks after the ramp ends", () => {
    const weeks = [week("2026-09-12", 40, 100), week("2026-10-03", 40, 100)];
    // 900 on the last ramp week, 500 once it is over, equal work in each.
    expect(effectiveTarget(weeks, stage, 500, true)).toEqual({ target: 700, ramping: true });
  });

  it("falls back to the steady target when nothing was worked", () => {
    expect(effectiveTarget([], stage, 500, true)).toEqual({ target: 500, ramping: false });
    expect(effectiveTarget([week("2026-09-05", 0, 0)], stage, 500, true)).toEqual({ target: 500, ramping: false });
  });

  it("does not call someone ramping for a stage week they did not work", () => {
    const weeks = [week("2026-09-05", 0, 0), week("2026-10-03", 40, 100)];
    expect(effectiveTarget(weeks, stage, 500, true)).toEqual({ target: 500, ramping: false });
  });
});
