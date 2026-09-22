import { describe, expect, it } from "vitest";
import type { MboRow } from "@/lib/queries/mbo";
import { groupByLeader, matchesMboFilter, parseMboFilter, UNASSIGNED_TEAM } from "./teams";

function row(overrides: Partial<MboRow> & { name: string }): MboRow {
  return {
    employeeId: `id-${overrides.name}`,
    eid: "900000000",
    supervisorName: "Dacanay,Beulah",
    mbo: 100,
    productionRate: 1.2,
    dpu: 99,
    dpo: 99,
    failedGates: [],
    passing: true,
    ...overrides,
  };
}

const herbias = "Archiene Ross Calderon Herbias";

const roster: MboRow[] = [
  row({ name: "Alba,Dorellyn", supervisorName: herbias, mbo: 66.7, passing: false, productionRate: 0.8, failedGates: ["Production rate"] }),
  row({ name: "Advincula,Ronn Rafael", supervisorName: herbias, mbo: 33.3, passing: false, productionRate: 0.6, dpu: 90, failedGates: ["Production rate", "DPU"] }),
  row({ name: "Bautista,Mae", supervisorName: herbias }),
  row({ name: "Cruz,Ana", supervisorName: herbias, mbo: null, passing: null, productionRate: null, dpu: null, dpo: null }),
  row({ name: "Aniban,Brandon Saludaga" }),
  row({ name: "Reyes,Jo", supervisorName: null, mbo: null, passing: null, productionRate: null, dpu: null, dpo: null }),
];

describe("groupByLeader", () => {
  it("folds the roster into one band per team leader with the counts and pass rate", () => {
    const [worst] = groupByLeader(roster);
    expect(worst.leader).toBe(herbias);
    expect(worst.agents).toBe(4);
    expect(worst.passing).toBe(1);
    expect(worst.failing).toBe(2);
    expect(worst.unscored).toBe(1);
    expect(worst.passRate).toBeCloseTo(33.33, 1);
    expect(worst.rows.map((r) => r.name)).toEqual(["Alba,Dorellyn", "Advincula,Ronn Rafael", "Bautista,Mae", "Cruz,Ana"]);
  });

  it("averages each gate over the agents who have it and counts who missed which gate", () => {
    const [herbiasTeam] = groupByLeader(roster);
    expect(herbiasTeam.avgProductionRate).toBeCloseTo((0.8 + 0.6 + 1.2) / 3, 6);
    expect(herbiasTeam.avgDpu).toBeCloseTo((99 + 90 + 99) / 3, 6);
    expect(herbiasTeam.avgDpo).toBeCloseTo(99, 6);
    expect(herbiasTeam.gateMisses).toEqual([
      { gate: "Production rate", count: 2 },
      { gate: "DPU", count: 1 },
    ]);
  });

  it("orders worst pass rate first, then unscored teams, with the unassigned band last", () => {
    const teams = groupByLeader(roster);
    expect(teams.map((t) => t.leader)).toEqual([herbias, "Dacanay,Beulah", UNASSIGNED_TEAM]);
    expect(teams[1].passRate).toBe(100);
    expect(teams[2].passRate).toBeNull();
    expect(teams[2].avgProductionRate).toBeNull();
    expect(teams[2].gateMisses).toEqual([]);

    const noScores = groupByLeader([
      row({ name: "A", supervisorName: "Zed", mbo: null, passing: null }),
      row({ name: "B", supervisorName: "Amy", mbo: null, passing: null }),
      row({ name: "C", supervisorName: "Mid" }),
    ]);
    expect(noScores.map((t) => t.leader)).toEqual(["Mid", "Amy", "Zed"]);
  });

  it("returns nothing for an empty roster", () => {
    expect(groupByLeader([])).toEqual([]);
  });
});

describe("MBO filter", () => {
  it("reads the page's status parameter, falling back to everyone", () => {
    expect(parseMboFilter("fail")).toBe("fail");
    expect(parseMboFilter("unscored")).toBe("unscored");
    expect(parseMboFilter("bogus")).toBe("all");
    expect(parseMboFilter(undefined)).toBe("all");
  });

  it("matches rows the way the tabs do", () => {
    expect(roster.filter((r) => matchesMboFilter(r, "all"))).toHaveLength(6);
    expect(roster.filter((r) => matchesMboFilter(r, "fail")).map((r) => r.name)).toEqual(["Alba,Dorellyn", "Advincula,Ronn Rafael"]);
    expect(roster.filter((r) => matchesMboFilter(r, "pass"))).toHaveLength(2);
    expect(roster.filter((r) => matchesMboFilter(r, "unscored"))).toHaveLength(2);
  });
});
