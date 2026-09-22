import { describe, expect, it } from "vitest";
import type { PeriodMetric } from "./period-metrics";
import { teamKpiFigures } from "./team-kpis";

function metric(employeeId: string, kpiCode: string, actualValue: number, sampleSize = 0, status: PeriodMetric["status"] = "PASS", targetValue: number | null = null): PeriodMetric {
  return {
    employeeId,
    kpiCode,
    kpiName: kpiCode,
    direction: "higher_is_better",
    actualValue,
    targetValue,
    status,
    sampleSize,
    skillReferenceId: null,
  };
}

describe("teamKpiFigures", () => {
  it("averages people for every KPI but NPS, and counts who was below target", () => {
    const [quality] = teamKpiFigures([
      metric("a", "QUALITY", 100, 4, "PASS", 98),
      metric("b", "QUALITY", 90, 1, "FAIL", 98),
    ]);
    expect(quality).toEqual({ code: "QUALITY", name: "QUALITY", avg: 95, target: 98, below: 1, scored: 2, surveys: null });
  });

  it("pools NPS by surveys: one survey is one vote, not one member", () => {
    // Sixteen surveys split 12 on one member at +50 and 4 on another at -100: pooled -12.5, averaged -25.
    const [nps] = teamKpiFigures([
      metric("a", "NPS", 50, 12, "PASS", 70),
      metric("b", "NPS", -100, 4, "FAIL", 70),
    ]);
    expect(nps.avg).toBe(((50 * 12) + (-100 * 4)) / 16);
    expect(nps.surveys).toBe(16);
    expect(nps.scored).toBe(2);
    expect(nps.below).toBe(1);
  });

  it("agrees with the manager's pooled figure that caught the averaging bug", () => {
    // One member with twenty surveys at 60, fifteen with one survey each at 100: a mean of members says 97.5.
    const rows = [metric("heavy", "NPS", 60, 20), ...Array.from({ length: 15 }, (_, i) => metric(`light-${i}`, "NPS", 100, 1))];
    const [nps] = teamKpiFigures(rows);
    expect(nps.avg).toBeCloseTo((60 * 20 + 100 * 15) / 35, 6);
    expect(nps.surveys).toBe(35);
  });

  it("counts an NPS row without a sample size for one survey rather than nothing", () => {
    const [nps] = teamKpiFigures([metric("a", "NPS", 100, 0), metric("b", "NPS", -100, 3)]);
    expect(nps.avg).toBe((100 - 300) / 4);
    expect(nps.surveys).toBe(4);
  });

  it("has no target when nobody carried one", () => {
    const [par] = teamKpiFigures([metric("a", "PRODUCTION_RATE", 3.1)]);
    expect(par.target).toBeNull();
  });
});
