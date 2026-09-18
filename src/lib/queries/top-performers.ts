import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { computeScorecards } from "@/lib/scorecard/load";
import { eligibleForPeriod } from "./eligibility";
import { joinPeriodOwner, periodOwnerSubquery, supervisorOfRecord } from "./org-history";
import { periodContaining } from "./period";
import { rank, rankSupervisors, type RankRow } from "./stack-rank";

/**
 * The month's top three agents and top three supervisors, for the podium
 * shown after sign-in.
 *
 * Ranked on exactly what the stack rank ranks on — the monthly scorecard's
 * final score, out of 5 — through the same `rank` and `rankSupervisors`
 * helpers, so the podium and `/stack-rank` can never name a different
 * winner for the same month. A supervisor's figure is their team's mean
 * over the members who have a score, as it is there.
 *
 * Organisation-wide and identical for every viewer, which is what makes it
 * cacheable: this runs on every sign-in for the whole roster, and
 * recomputing a few hundred scorecards per login is the one thing this
 * page must not do. The first person in after an import pays for it on
 * everybody's behalf; `serialized` keeps a shift-start rush from starting
 * that computation four hundred times at once.
 */
export interface PodiumPerson {
  /** 1, 2 or 3 — the place, not the index. */
  place: number;
  name: string;
  /** The monthly scorecard's final score, out of 5. Never null: an unscored person is not on a podium. */
  score: number;
  /** Team size for a supervisor; null for an agent. */
  teamSize: number | null;
}

export interface TopPerformers {
  /** The month these cover, as its first day. */
  monthStart: string;
  agents: PodiumPerson[];
  supervisors: PodiumPerson[];
}

export const PODIUM_PLACES = 3;

/**
 * Someone with no score is not "last", they are unmeasured — `rank` already
 * sorts them behind everyone scored, and this drops them rather than
 * letting a thin month put an unscored name on a podium.
 */
export function topThree(rows: Array<{ name: string; score: number | null; teamSize?: number }>): PodiumPerson[] {
  return rows
    .filter((row) => row.score !== null)
    .slice(0, PODIUM_PLACES)
    .map((row, i) => ({
      place: i + 1,
      name: row.name,
      score: row.score as number,
      teamSize: row.teamSize ?? null,
    }));
}

export function getTopPerformers(monthStart: string): Promise<TopPerformers> {
  return readTopPerformers(periodContaining("month", monthStart).start);
}

const readTopPerformers = cachedRead(
  "top-performers",
  [CACHE_TAG.imports, CACHE_TAG.reference, CACHE_TAG.ramp, CACHE_TAG.ews],
  (monthStart: string): Promise<TopPerformers> =>
    serialized("top-performers", () => computeTopPerformers(monthStart)),
);

async function computeTopPerformers(monthStart: string): Promise<TopPerformers> {
  const month = periodContaining("month", monthStart);

  // Who held whom for most of the month, the same ownership rule the stack
  // rank and the team roster use — so a supervisor who inherited a team on
  // the last day of the month does not collect its podium place.
  const owner = periodOwnerSubquery(month);
  const everyone = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      supervisorName: supervisorOfRecord(owner),
    })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner));

  // Who counted for THIS month rather than who is employed today: a leaver
  // who topped the month still topped it.
  const eligible = new Set(await eligibleForPeriod(everyone.map((r) => r.id), month));
  const roster = everyone.filter((r) => eligible.has(r.id));
  if (roster.length === 0) return { monthStart: month.start, agents: [], supervisors: [] };

  const cards = await computeScorecards(roster.map((r) => r.id), month.start);

  const ranked = rank(
    roster.map((r) => ({
      employeeId: r.id,
      eid: r.eid,
      name: r.name,
      site: null,
      supervisorName: r.supervisorName,
      score: cards.get(r.id)?.finalScore ?? null,
      // The podium shows a name and a score and nothing else, so the other
      // ranking columns are not read — they are here because RankRow is the
      // shape `rank` and `rankSupervisors` share with the stack rank.
      productionRate: null,
      mbo: null,
      quality: null,
      attendance: null,
    })),
  );

  const bySupervisor = new Map<string, RankRow[]>();
  for (const row of ranked) {
    if (!row.supervisorName) continue;
    bySupervisor.set(row.supervisorName, [...(bySupervisor.get(row.supervisorName) ?? []), row]);
  }

  return {
    monthStart: month.start,
    agents: topThree(ranked),
    supervisors: topThree(
      rankSupervisors(bySupervisor).map((s) => ({
        name: s.supervisorName,
        score: s.score,
        teamSize: s.teamSize,
      })),
    ),
  };
}
