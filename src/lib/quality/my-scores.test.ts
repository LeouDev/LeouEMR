import { describe, expect, it } from "vitest";
import { byDate, failedFindings, groupedResults, scoreTone, summarizeMine, type MyAudit, type MyResult } from "./my-scores";

const pass = (position: number, category: string, attribute: string): MyResult => ({
  position,
  category,
  attribute,
  isCompliance: false,
  result: "pass",
});
const fail = (position: number, category: string, attribute: string): MyResult => ({ ...pass(position, category, attribute), result: "fail" });

function audit(over: Partial<MyAudit> & { id: string; auditDate: string; scorePct: number }): MyAudit {
  return {
    formLabel: "Phone Form",
    evaluatorName: "Lopez, Ana",
    isCritical: false,
    remarks: null,
    acknowledgedAt: null,
    results: [pass(0, "Greeting", "a. Did not provide name/department"), pass(1, "Documentation", "a. Did not select appropriate dropdown options")],
    ...over,
  };
}

const AUDITS: MyAudit[] = [
  audit({ id: "c", auditDate: "2026-09-09", scorePct: 94, results: [pass(0, "Greeting", "a. Did not provide name/department"), fail(1, "Documentation", "b. Did not revise guided verbiage with pertinent details")] }),
  audit({ id: "a", auditDate: "2026-08-12", scorePct: 100 }),
  audit({ id: "b", auditDate: "2026-08-19", scorePct: 94, results: [fail(1, "Documentation", "b. Did not revise guided verbiage with pertinent details")] }),
  audit({ id: "d", auditDate: "2026-09-02", scorePct: 0, isCritical: true, results: [fail(9, "Compliance", "Wrong member selected")] }),
];

describe("summarizeMine", () => {
  const summary = summarizeMine(AUDITS);

  it("counts, averages and rates the agent's own audits with the leaders' pass rule", () => {
    expect(summary.kpis.map((k) => [k.label, k.value])).toEqual([
      ["Audits received", "4"],
      ["Average score", "72%"],
      ["Pass rate", "75%"],
      ["Latest score", "94%"],
    ]);
    expect(summary.kpis[1].tone).toBe("ink");
    expect(summary.kpis[3].tone).toBe("pass");
  });

  it("plots oldest to newest and flags an audit with any failed attribute", () => {
    expect(summary.trend.map((p) => [p.label, p.scorePct, p.hadFail])).toEqual([
      ["Aug 12", 100, false],
      ["Aug 19", 94, true],
      ["Sep 2", 0, true],
      ["Sep 9", 94, true],
    ]);
  });

  it("ranks the most frequent failed attributes", () => {
    expect(summary.focus).toEqual([
      { label: "Documentation: b. Did not revise guided verbiage with pertinent details", count: 2 },
      { label: "Compliance: Wrong member selected", count: 1 },
    ]);
  });

  it("has nothing to say before the first audit", () => {
    const empty = summarizeMine([]);
    expect(empty.kpis.map((k) => k.value)).toEqual(["0", "—", "—", "—"]);
    expect(empty.trend).toEqual([]);
    expect(empty.focus).toEqual([]);
  });
});

describe("helpers", () => {
  it("colours a score like the leaders' pages: pass green, monitor ink, fail or critical red", () => {
    expect(scoreTone(95)).toBe("pass");
    expect(scoreTone(80)).toBe("ink");
    expect(scoreTone(60)).toBe("fail");
    expect(scoreTone(95, true)).toBe("fail");
  });

  it("orders by date and lists only the failed findings", () => {
    expect(byDate(AUDITS).map((a) => a.id)).toEqual(["a", "b", "d", "c"]);
    expect(failedFindings(AUDITS[0]).map((f) => f.attribute)).toEqual(["b. Did not revise guided verbiage with pertinent details"]);
    expect(failedFindings(AUDITS[1])).toEqual([]);
  });

  it("groups the full form by category in form order", () => {
    const grouped = groupedResults(
      audit({
        id: "x",
        auditDate: "2026-09-01",
        scorePct: 90,
        results: [pass(2, "Member", "a. x"), fail(1, "Greeting", "b. y"), pass(0, "Greeting", "a. z"), pass(3, "Compliance", "c")],
      }),
    );
    expect(grouped.map((g) => [g.name, g.items.map((i) => i.attribute)])).toEqual([
      ["Greeting", ["a. z", "b. y"]],
      ["Member", ["a. x"]],
      ["Compliance", ["c"]],
    ]);
  });
});
