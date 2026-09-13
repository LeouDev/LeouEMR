import { describe, expect, it } from "vitest";
import { focusAgents, type FocusMetric } from "./focus";

const people = new Map([
  ["a", { name: "Abad, Maria", eid: "1" }],
  ["b", { name: "Cruz, Ana", eid: "2" }],
  ["c", { name: "Dela Cruz, José", eid: "3" }],
  ["d", { name: "Santos, Rey", eid: "4" }],
]);
const m = (over: Partial<FocusMetric> & { employeeId: string; kpiCode: string; status: string }): FocusMetric => ({
  kpiName: over.kpiCode,
  direction: "higher_is_better",
  actualValue: 80,
  targetValue: 90,
  ...over,
});

describe("focusAgents", () => {
  it("ranks by KPIs below target, then at risk, then the size of the worst miss, and names the worst measure", () => {
    const metrics = [
      m({ employeeId: "a", kpiCode: "QUALITY", status: "FAIL", actualValue: 70, targetValue: 90 }),
      m({ employeeId: "a", kpiCode: "AHT", status: "FAIL", direction: "lower_is_better", actualValue: 600, targetValue: 420 }),
      m({ employeeId: "b", kpiCode: "QUALITY", status: "FAIL", actualValue: 85, targetValue: 90 }),
      m({ employeeId: "b", kpiCode: "NPS", status: "WARNING", actualValue: 50, targetValue: 55 }),
      m({ employeeId: "c", kpiCode: "QUALITY", status: "FAIL", actualValue: 60, targetValue: 90 }),
      m({ employeeId: "d", kpiCode: "QUALITY", status: "PASS", actualValue: 95, targetValue: 90 }),
      m({ employeeId: "d", kpiCode: "NPS", status: "WARNING", actualValue: 54, targetValue: 55 }),
    ];
    const ranked = focusAgents(metrics, people);
    expect(ranked.map((r) => r.name)).toEqual(["Abad, Maria", "Cruz, Ana", "Dela Cruz, José", "Santos, Rey"]);
    // AHT is 43% over; quality 22% under — AHT is the one to look at.
    expect(ranked[0]).toMatchObject({ below: 2, atRisk: 0, worst: { code: "AHT", actual: 600, target: 420 } });
    // One below plus one at risk outranks one below alone, whatever the miss.
    expect(ranked[1]).toMatchObject({ below: 1, atRisk: 1, worst: { code: "QUALITY" } });
    expect(ranked[2]).toMatchObject({ below: 1, atRisk: 0 });
    // A warning-only agent still lists, with the warning as the worst measure.
    expect(ranked[3]).toMatchObject({ below: 0, atRisk: 1, worst: { code: "NPS" } });
  });

  it("caps the list, skips people it cannot name, and is empty when everyone passes", () => {
    const many = ["a", "b", "c", "d", "x"].map((id) => m({ employeeId: id, kpiCode: "QUALITY", status: "FAIL" }));
    expect(focusAgents(many, people, 2)).toHaveLength(2);
    expect(focusAgents(many, people).map((r) => r.employeeId)).not.toContain("x");
    expect(focusAgents([m({ employeeId: "a", kpiCode: "QUALITY", status: "PASS" })], people)).toEqual([]);
  });
});
