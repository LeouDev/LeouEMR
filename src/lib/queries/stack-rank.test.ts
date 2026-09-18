import { describe, expect, it } from "vitest";
import { meanPresent, rank, rankScored, rankSupervisors, type RankRow } from "./stack-rank";

type Seed = { name: string; score: number | null; productionRate?: number | null; mbo?: number | null };

function people(seeds: Seed[]): Omit<RankRow, "rank">[] {
  return seeds.map((s, i) => ({
    employeeId: `emp-${i}`,
    eid: `00000000${i}`,
    name: s.name,
    site: "CEBU",
    supervisorName: "Santos, Maria",
    score: s.score,
    productionRate: s.productionRate ?? null,
    mbo: s.mbo ?? null,
    quality: null,
    attendance: null,
  }));
}

describe("rank", () => {
  it("orders by the scorecard score, best first", () => {
    const ranked = rank(
      people([
        { name: "Middle", score: 3.2 },
        { name: "Best", score: 4.8 },
        { name: "Worst", score: 1.4 },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Best", "Middle", "Worst"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks on the score, not the production rating that is one row of it", () => {
    const ranked = rank(
      people([
        { name: "HighRating", score: 3.1, productionRate: 4.9 },
        { name: "HighScore", score: 4.2, productionRate: 3.0 },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["HighScore", "HighRating"]);
  });

  it("puts people with no score last, not first", () => {
    // A missing score must never outrank a real one — absent data is not a
    // perfect score, and it is not a zero either.
    const ranked = rank(
      people([
        { name: "Unscored", score: null },
        { name: "Poor", score: 1.05 },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Poor", "Unscored"]);
  });

  it("orders the unscored among themselves by name, so the list is stable", () => {
    const ranked = rank(
      people([
        { name: "Zamora", score: null },
        { name: "Abad", score: null },
      ]),
    );
    expect(ranked.map((r) => r.name)).toEqual(["Abad", "Zamora"]);
  });

  it("numbers every row consecutively from one", () => {
    const ranked = rank(people(Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, score: i }))));
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

  it("ranks by the team's mean scorecard score", () => {
    const ranked = rankSupervisors(
      new Map([
        team("Weak", [{ name: "a", score: 2 }, { name: "b", score: 2 }]),
        team("Strong", [{ name: "c", score: 4 }, { name: "d", score: 4.5 }]),
      ]),
    );
    expect(ranked.map((r) => r.supervisorName)).toEqual(["Strong", "Weak"]);
    expect(ranked[0].score).toBeCloseTo(4.25, 6);
  });

  it("averages over scored members only, so sparse data does not depress a team", () => {
    // Two strong performers and three unscored: the mean is 4, not 1.6.
    const ranked = rankSupervisors(
      new Map([
        team("Sparse", [
          { name: "a", score: 4 },
          { name: "b", score: 4 },
          { name: "c", score: null },
          { name: "d", score: null },
          { name: "e", score: null },
        ]),
      ]),
    );
    expect(ranked[0].score).toBe(4);
    expect(ranked[0].teamSize).toBe(5);
    expect(ranked[0].scored).toBe(2);
  });

  it("ranks a team with no scores at all below any team that has one", () => {
    const ranked = rankSupervisors(
      new Map([
        team("NoData", [{ name: "a", score: null }]),
        team("Low", [{ name: "b", score: 1.02 }]),
      ]),
    );
    expect(ranked.map((r) => r.supervisorName)).toEqual(["Low", "NoData"]);
    expect(ranked[1].score).toBeNull();
  });

  it("reports team size and scored count separately, and carries the mean rating alongside", () => {
    const ranked = rankSupervisors(
      new Map([team("Mixed", [{ name: "a", score: 3, productionRate: 3.4 }, { name: "b", score: null }])]),
    );
    expect(ranked[0]).toMatchObject({ teamSize: 2, scored: 1, productionRate: 3.4 });
  });
});

describe("rankScored", () => {
  it("leaves the unscored out of the ranking rather than at the bottom of it", () => {
    const rows = rankScored(people([
      { name: "Scored high", score: 4.6 },
      { name: "No hours this month", score: null },
      { name: "Scored low", score: 3.1 },
    ]));

    expect(rows.map((r) => r.name)).toEqual(["Scored high", "Scored low"]);
  });

  it("numbers the places over the people actually in it", () => {
    // Not "1, 3" with a gap where the unscored person was taken out.
    const rows = rankScored(people([
      { name: "A", score: 4.6 },
      { name: "Unmeasured", score: null },
      { name: "B", score: 3.1 },
    ]));

    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("gives back nothing for a month nobody was measured in", () => {
    // Which is what the page's own "0 of 410 scored" line is there to say.
    expect(rankScored(people([{ name: "A", score: null }, { name: "B", score: null }]))).toEqual([]);
  });

  it("still ranks a low score, which is a result rather than an absence", () => {
    const rows = rankScored(people([{ name: "Struggling", score: 1.2 }]));

    expect(rows.map((r) => r.name)).toEqual(["Struggling"]);
  });
});
