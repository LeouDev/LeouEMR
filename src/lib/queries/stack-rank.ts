import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { CurrentUser } from "@/lib/auth/session";
import { resolveScopedIds } from "./performance";
import { assignmentAt, siteOfRecord, supervisorOfRecord } from "./org-history";
import { employeeAssignments, employees } from "@/lib/db/schema";
import { getPeriodMetrics } from "./period-metrics";
import type { Period } from "./period";

export interface RankRow {
  rank: number;
  employeeId: string;
  eid: string;
  name: string;
  supervisorName: string | null;
  site: string | null;
  /** The PAR production rating, 1.00–5.00. The ranking key. */
  productionRate: number | null;
  mbo: number | null;
  quality: number | null;
  attendance: number | null;
}

export interface SupervisorRankRow {
  rank: number;
  supervisorName: string;
  teamSize: number;
  /** Mean production rating across the team members who have one. */
  productionRate: number | null;
  mbo: number | null;
  scored: number;
}

/**
 * Ranks on the PAR production rating, the score the business already uses to
 * rate performance. Someone with no rating in the period is listed last
 * rather than treated as a zero — absent data is not a bad result.
 */
export function rank(rows: Omit<RankRow, "rank">[]): RankRow[] {
  return rows
    .sort((a, b) => {
      if (a.productionRate === null && b.productionRate === null) {
        return a.name.localeCompare(b.name);
      }
      if (a.productionRate === null) return 1;
      if (b.productionRate === null) return -1;
      return b.productionRate - a.productionRate;
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Pulls the ranking metrics for a set of employees over one period. */
async function metricsFor(employeeIds: string[], period: Period) {
  const metrics = await getPeriodMetrics(employeeIds, period);
  const byEmployee = new Map<string, Record<string, number>>();
  for (const m of metrics) {
    const entry = byEmployee.get(m.employeeId) ?? {};
    entry[m.kpiCode] = m.actualValue;
    byEmployee.set(m.employeeId, entry);
  }
  return byEmployee;
}

export interface StackRanks {
  team: RankRow[];
  /** Everyone active, across every site. */
  org: RankRow[];
  supervisors: SupervisorRankRow[];
  teamLabel: string | null;
  siteLabel: string | null;
}

/**
 * Stack ranks for one person's team, the whole organization, and every
 * supervisor in it.
 *
 * The organization ranking is deliberately unscoped: a stack rank exists to
 * show where you stand among peers, which a ranking of only your own team —
 * or only your own site — cannot answer. Sites vary in size and skill mix, so
 * ranking within one hides how a small site compares to a large one.
 */
export async function getStackRanks(
  viewer: CurrentUser,
  /** The viewer's own roster row, or null for a leader, who has none. */
  self: { id: string; site: string | null; supervisorName: string | null } | null,
  period: Period,
): Promise<StackRanks> {
  // Who the viewer may see in detail. The ranking itself is deliberately
  // organization-wide — a stack rank that hid your peers could not tell you
  // where you stand — but quality and attendance are personnel matters, not
  // ranking inputs, so they are shown only for the viewer's own scope.
  const visible = new Set(await resolveScopedIds(viewer));
  // Ranked against the teams as they stood at the end of the period. Ranking
  // August by today's structure would put people in a team they were not on,
  // and move a supervisor's result to whoever inherited their reports.
  const roster = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      site: siteOfRecord,
      supervisorName: supervisorOfRecord,
    })
    .from(employees)
    .leftJoin(employeeAssignments, assignmentAt(period.end))
    .where(eq(employees.status, "active"));

  if (roster.length === 0) {
    return {
      team: [],
      org: [],
      supervisors: [],
      teamLabel: self?.supervisorName ?? null,
      siteLabel: self?.site ?? null,
    };
  }

  const byEmployee = await metricsFor(
    roster.map((r) => r.id),
    period,
  );

  const build = (rows: typeof roster) =>
    rank(
      rows.map((r) => {
        const m = byEmployee.get(r.id) ?? {};
        return {
          employeeId: r.id,
          eid: r.eid,
          name: r.name,
          site: r.site,
          supervisorName: r.supervisorName,
          productionRate: m.PRODUCTION_RATE ?? null,
          mbo: m.MBO ?? null,
          quality: visible.has(r.id) ? (m.QUALITY ?? null) : null,
          attendance: visible.has(r.id) ? (m.ATTENDANCE ?? null) : null,
        };
      }),
    );

  const org = build(roster);

  // A leader has no roster row, so "my team" cannot come from their own
  // supervisor name — it is their scope. Without this the page showed every
  // supervisor and manager an "Account not linked" empty state.
  const team = self?.supervisorName
    ? build(roster.filter((r) => r.supervisorName === self.supervisorName))
    : viewer.role === "agent"
      ? []
      : build(roster.filter((r) => visible.has(r.id)));

  // Supervisors are ranked by their team's mean rating, over the members who
  // actually have one — otherwise a team with sparse data would rank low for
  // having no data rather than for performing badly.
  const bySupervisor = new Map<string, RankRow[]>();
  for (const row of org) {
    if (!row.supervisorName) continue;
    bySupervisor.set(row.supervisorName, [...(bySupervisor.get(row.supervisorName) ?? []), row]);
  }

  const supervisors = rankSupervisors(bySupervisor);

  return {
    team,
    org,
    supervisors,
    teamLabel:
      self?.supervisorName ??
      (viewer.role === "manager" ? "Your span" : viewer.role === "supervisor" ? viewer.name : null),
    siteLabel: self?.site ?? null,
  };
}

/** Mean of the values that are present; null when none are. */
export function meanPresent(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

/**
 * Ranks supervisors by their team's mean rating.
 *
 * The mean is over members who actually have a rating, so a team with sparse
 * data ranks on how its scored members performed rather than being pushed
 * down for having fewer of them. `scored` is reported alongside so a thin
 * sample is visible rather than hidden.
 */
export function rankSupervisors(teams: Map<string, RankRow[]>): SupervisorRankRow[] {
  return [...teams.entries()]
    .map(([supervisorName, members]) => ({
      supervisorName,
      teamSize: members.length,
      scored: members.filter((m) => m.productionRate !== null).length,
      productionRate: meanPresent(members.map((m) => m.productionRate)),
      mbo: meanPresent(members.map((m) => m.mbo)),
    }))
    .sort((a, b) => (b.productionRate ?? -1) - (a.productionRate ?? -1))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
