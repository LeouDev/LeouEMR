import { describe, expect, it } from "vitest";
import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import type { PeriodMetric } from "./period-metrics";
import { NO_SUPERVISOR_KPIS, rollUpSupervisorKpis } from "./supervisor-kpis";

const metric = (over: Partial<PeriodMetric> & Pick<PeriodMetric, "employeeId" | "kpiCode">): PeriodMetric => ({
  kpiName: over.kpiCode,
  direction: "higher_is_better",
  actualValue: 0,
  targetValue: null,
  status: "PASS",
  sampleSize: 10,
  skillReferenceId: null,
  ...over,
});

/** Two on Ana's team, one on Ben's. */
const TEAM: Record<string, string | null> = { a1: "Ana", a2: "Ana", b1: "Ben" };

describe("rollUpSupervisorKpis", () => {
  it("counts production against the same gate MBO uses, not the KPI's warning band", () => {
    // 2.99 is the business's pass line and the one MBO_GATES carries; the KPI
    // definition calls it a WARNING, which would read as a miss here.
    const rows = rollUpSupervisorKpis(
      [
        metric({ employeeId: "a1", kpiCode: "PRODUCTION_RATE", actualValue: MBO_GATES.productionRate, status: "WARNING" }),
        metric({ employeeId: "a2", kpiCode: "PRODUCTION_RATE", actualValue: 2.98, status: "FAIL" }),
      ],
      TEAM,
    );

    expect(rows.get("Ana")).toMatchObject({ prodPassing: 1, prodScored: 2, prodPassRate: 50 });
  });

  it("averages a level over the members who have one, and says how many that was", () => {
    const rows = rollUpSupervisorKpis(
      [
        metric({ employeeId: "a1", kpiCode: "QUALITY", actualValue: 96 }),
        metric({ employeeId: "a2", kpiCode: "QUALITY", actualValue: 100 }),
        // a2 has no NPS: the team's NPS is a1's alone, not halved by a zero.
        metric({ employeeId: "a1", kpiCode: "NPS", actualValue: 80 }),
      ],
      TEAM,
    );

    expect(rows.get("Ana")).toMatchObject({
      quality: 98,
      qualityScored: 2,
      nps: 80,
      npsScored: 1,
    });
  });

  it("keeps each supervisor's team to itself", () => {
    const rows = rollUpSupervisorKpis(
      [
        metric({ employeeId: "a1", kpiCode: "QUALITY", actualValue: 99 }),
        metric({ employeeId: "b1", kpiCode: "QUALITY", actualValue: 80 }),
      ],
      TEAM,
    );

    expect(rows.get("Ana")?.quality).toBe(99);
    expect(rows.get("Ben")?.quality).toBe(80);
  });

  it("leaves out results for people no supervisor in the roster owns", () => {
    const rows = rollUpSupervisorKpis(
      [metric({ employeeId: "nobody", kpiCode: "QUALITY", actualValue: 10 })],
      TEAM,
    );

    expect(rows.size).toBe(0);
  });

  it("ignores a skill's own result, which is a work item rather than one of these KPIs", () => {
    const rows = rollUpSupervisorKpis(
      [
        metric({ employeeId: "a1", kpiCode: "QUALITY", actualValue: 96 }),
        metric({ employeeId: "a2", kpiCode: "QUALITY", actualValue: 40, skillReferenceId: "skill-1" }),
      ],
      TEAM,
    );

    expect(rows.get("Ana")).toMatchObject({ quality: 96, qualityScored: 1 });
  });

  it("takes the strictest target where a period spans a change, so a row must clear both rules", () => {
    const rows = rollUpSupervisorKpis(
      [
        metric({ employeeId: "a1", kpiCode: "QUALITY", actualValue: 96, targetValue: 95 }),
        metric({ employeeId: "a2", kpiCode: "QUALITY", actualValue: 96, targetValue: 98 }),
      ],
      TEAM,
    );

    expect(rows.get("Ana")?.qualityTarget).toBe(98);
  });

  it("reads as nothing measured rather than as zero when a team has no results", () => {
    expect(rollUpSupervisorKpis([], TEAM).get("Ana")).toBeUndefined();
    expect(NO_SUPERVISOR_KPIS).toMatchObject({
      prodPassRate: null,
      prodScored: 0,
      quality: null,
      nps: null,
    });
  });
});
