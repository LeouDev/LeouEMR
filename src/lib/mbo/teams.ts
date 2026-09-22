import type { MboRow } from "@/lib/queries/mbo";

/**
 * The MBO roster folded per team leader, for the page's expandable bands
 * and the CSV that mirrors them. Pure: the roster comes from the query,
 * the shape here is only arithmetic, so it is tested without a database.
 */

export type MboFilter = "all" | "pass" | "fail" | "unscored";

export const MBO_FILTERS: Array<{ key: MboFilter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "fail", label: "Failing" },
  { key: "pass", label: "Passing" },
  { key: "unscored", label: "No score" },
];

export function parseMboFilter(value: string | undefined): MboFilter {
  return MBO_FILTERS.find((f) => f.key === value)?.key ?? "all";
}

export function matchesMboFilter(row: Pick<MboRow, "passing">, filter: MboFilter): boolean {
  switch (filter) {
    case "pass":
      return row.passing === true;
    case "fail":
      return row.passing === false;
    case "unscored":
      return row.passing === null;
    default:
      return true;
  }
}

/** Nobody of record held the person for the period; they still count somewhere. */
export const UNASSIGNED_TEAM = "Unassigned";

export interface MboTeam {
  leader: string;
  /** The team's whole roster, in the roster's order (failing first). */
  rows: MboRow[];
  agents: number;
  passing: number;
  failing: number;
  unscored: number;
  /** Passing as a share of the scored, 0-100; null when nobody was scored. */
  passRate: number | null;
  /** Means over the agents who have the figure; null when none do. */
  avgProductionRate: number | null;
  avgDpu: number | null;
  avgDpo: number | null;
  /** How many agents missed each gate, most first. Empty when everyone passed. */
  gateMisses: Array<{ gate: string; count: number }>;
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((sum, v) => sum + v, 0) / present.length;
}

/**
 * One band per team leader, worst pass rate first so the teams that need
 * working through come up top — the same reason the roster puts failing
 * agents first. Teams with nobody scored sort after the scored ones, and
 * the unassigned band last; ties fall to the leader's name.
 */
export function groupByLeader(rows: readonly MboRow[]): MboTeam[] {
  const byLeader = new Map<string, MboRow[]>();
  for (const row of rows) {
    const key = row.supervisorName ?? UNASSIGNED_TEAM;
    byLeader.set(key, [...(byLeader.get(key) ?? []), row]);
  }

  const teams = [...byLeader.entries()].map(([leader, members]): MboTeam => {
    const passing = members.filter((r) => r.passing === true).length;
    const failing = members.filter((r) => r.passing === false).length;
    const unscored = members.filter((r) => r.passing === null).length;
    const scored = passing + failing;

    const misses = new Map<string, number>();
    for (const row of members) {
      for (const gate of row.failedGates) misses.set(gate, (misses.get(gate) ?? 0) + 1);
    }

    return {
      leader,
      rows: members,
      agents: members.length,
      passing,
      failing,
      unscored,
      passRate: scored === 0 ? null : (passing / scored) * 100,
      avgProductionRate: mean(members.map((r) => r.productionRate)),
      avgDpu: mean(members.map((r) => r.dpu)),
      avgDpo: mean(members.map((r) => r.dpo)),
      gateMisses: [...misses.entries()]
        .map(([gate, count]) => ({ gate, count }))
        .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
    };
  });

  return teams.sort((a, b) => {
    if (a.leader === UNASSIGNED_TEAM) return 1;
    if (b.leader === UNASSIGNED_TEAM) return -1;
    if (a.passRate === null && b.passRate === null) return a.leader.localeCompare(b.leader);
    if (a.passRate === null) return 1;
    if (b.passRate === null) return -1;
    return a.passRate - b.passRate || a.leader.localeCompare(b.leader);
  });
}
