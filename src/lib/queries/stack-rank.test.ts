import { describe, expect, it } from "vitest";
import { meanPresent, rank, rankSupervisors, type RankRow } from "./stack-rank";

type Seed = { name: string; productionRate: number | null; mbo?: number | null };

function people(seeds: Seed[]): Omit<RankRow, "rank">[] {
  return seeds.map((s, i) => ({
    employeeId: `emp-${i}`,
    eid: `00000000${i}`,
    name: s.name,
    site: "CEBU",
    supervisorName: "Santos, Maria",
    productionRate: s.productionRate,
    mbo: s.mbo ?? null,
    quality: null,
    attendance: null,
  }));
}

describe("rank", () => {
  it("orders by production rating, best first", () => {
    const ranked = rank(
      people([
        { name: "Middle", productionRate: 3.2 },
        { name: "Best", productionRate: 4.8 },
        { name: "Worst", productionRate: 1.4 },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Best", "Middle", "Worst"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("puts people with no rating last, not first", () => {
    // A missing rating must never outrank a real one — absent data is not a
    // perfect score, and it is not a zero either.
    const ranked = rank(
      people([
        { name: "Unrated", productionRate: null },
        { name: "Poor", productionRate: 1.05 },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Poor", "Unrated"]);
  });

  it("orders the unrated among themselves by name, so the list is stable", () => {
    const ranked = rank(
      people([
        { name: "Zamora", productionRate: null },
        { name: "Abad", productionRate: null },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Abad", "Zamora"]);
  });

  it("numbers every row consecutively from one", () => {
    const ranked = rank(people(Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, productionRate: i }))));
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles an empty roster", () => {
    expect(rank([])).toEqual([]);
  });
});

describe("meanPresent", () => {
  it("averages only the values that exist", () => {
    expect(meanPresent([2, null, 4])).toBe(3);
  });

  it("is null when nothing is present, rather than zero", () => {
    expect(meanPresent([null, null])).toBeNull();
    expect(meanPresent([])).toBeNull();
  });
});

describe("rankSupervisors", () => {
  const team = (name: string, seeds: Seed[]) =>
    [name, rank(people(seeds))] as const;

  it("ranks by the team's mean rating", () => {
    const ranked = rankSupervisors(
      new Map([
        team("Weak", [{ name: "a", productionRate: 2 }, { name: "b", productionRate: 2 }]),
        team("Strong", [{ name: "c", productionRate: 4 }, { name: "d", productionRate: 4.5 }]),
      ]),
    );
    expect(ranked.map((r) => r.supervisorName)).toEqual(["Strong", "Weak"]);
    expect(ranked[0].productionRate).toBeCloseTo(4.25, 6);
  });

  it("averages over scored members only, so sparse data does not depress a team", () => {
    // Two strong performers and three unrated: the mean is 4, not 1.6.
    const ranked = rankSupervisors(
      new Map([
        team("Sparse", [
          { name: "a", productionRate: 4 },
          { name: "b", productionRate: 4 },
          { name: "c", productionRate: null },
          { name: "d", productionRate: null },
          { name: "e", productionRate: null },
        ]),
      ]),
    );
    expect(ranked[0].productionRate).toBe(4);
    expect(ranked[0].teamSize).toBe(5);
    expect(ranked[0].scored).toBe(2);
  });

  it("ranks a team with no ratings at all below any team that has one", () => {
    const ranked = rankSupervisors(
      new Map([
        team("NoData", [{ name: "a", productionRate: null }]),
        team("Low", [{ name: "b", productionRate: 1.02 }]),
      ]),
    );
    expect(ranked.map((r) => r.supervisorName)).toEqual(["Low", "NoData"]);
    expect(ranked[1].productionRate).toBeNull();
  });

  it("reports team size and scored count separately", () => {
    const ranked = rankSupervisors(
      new Map([team("Mixed", [{ name: "a", productionRate: 3 }, { name: "b", productionRate: null }])]),
    );
    expect(ranked[0]).toMatchObject({ teamSize: 2, scored: 1 });
  });
});
