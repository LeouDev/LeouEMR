import { eq, inArray } from "drizzle-orm";
import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { employees, userAvatars } from "@/lib/db/schema";
import { computeScorecards } from "@/lib/scorecard/load";
import { eligibleForPeriod } from "./eligibility";
import {
  joinPeriodOwner,
  periodOwnerSubquery,
  supervisorEidOfRecord,
  supervisorOfRecord,
} from "./org-history";
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
  /**
   * Whose profile picture to show, as an employee id — their own for an
   * agent, and for a supervisor the roster row their EID points at. Null
   * when there is nobody to point at (a leader with no roster row).
   */
  photoId: string | null;
  /**
   * The picture's own version, as epoch milliseconds, or null when this
   * person has not uploaded one.
   *
   * It does two jobs. It tells the page there is a photo at all, so a
   * person without one renders the illustrated fallback without a request
   * that could only 404. And it makes every upload a new URL, which is what
   * lets the response be cached for good.
   */
  photoVersion: number | null;
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
export function topThree(
  rows: Array<{ name: string; score: number | null; teamSize?: number; photoId?: string | null }>,
): PodiumPerson[] {
  return rows
    .filter((row) => row.score !== null)
    .slice(0, PODIUM_PLACES)
    .map((row, i) => ({
      place: i + 1,
      name: row.name,
      score: row.score as number,
      teamSize: row.teamSize ?? null,
      photoId: row.photoId ?? null,
      photoVersion: null,
    }));
}

/**
 * Stamps each person with the version of the picture they actually have.
 *
 * Separate from the read so the rule is testable: no entry means no
 * picture, which the page reads as "draw the fallback" rather than as "ask
 * for one and see".
 */
export function withPhotoVersions(
  people: PodiumPerson[],
  versions: Record<string, number>,
): PodiumPerson[] {
  return people.map((person) => ({
    ...person,
    photoVersion: person.photoId ? (versions[person.photoId] ?? null) : null,
  }));
}

export function getTopPerformers(monthStart: string): Promise<TopPerformers> {
  return readTopPerformers(periodContaining("month", monthStart).start);
}

/**
 * Whose picture this month's podium is entitled to show.
 *
 * The avatar route answers with this and nothing else: a profile picture is
 * served to its owner alone everywhere else in the app, and the podium is
 * the one deliberate exception — six people, for as long as they are on it.
 */
export async function podiumPhotoIds(monthStart: string): Promise<Set<string>> {
  const podium = await getTopPerformers(monthStart);
  return new Set(
    [...podium.agents, ...podium.supervisors]
      .map((person) => person.photoId)
      .filter((id): id is string => id !== null),
  );
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
      supervisorEid: supervisorEidOfRecord(owner),
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
      // The podium shows a name, a score and a face, so the other ranking
      // columns are not read — they are here because RankRow is the shape
      // `rank` and `rankSupervisors` share with the stack rank.
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

  // A supervisor is a name in this data, not a row, so their picture has to
  // be found through the EID their team's rows point at — the authoritative
  // link the raw workbook carries. A leader with no roster row of their own
  // simply has no picture to find, and gets the illustrated fallback.
  const idByEid = new Map(roster.map((r) => [r.eid, r.id]));
  const eidBySupervisor = new Map<string, string>();
  for (const r of roster) {
    if (r.supervisorName && r.supervisorEid && !eidBySupervisor.has(r.supervisorName)) {
      eidBySupervisor.set(r.supervisorName, r.supervisorEid);
    }
  }

  const agents = topThree(ranked.map((r) => ({ ...r, photoId: r.employeeId })));
  const supervisors = topThree(
    rankSupervisors(bySupervisor).map((s) => ({
      name: s.supervisorName,
      score: s.score,
      teamSize: s.teamSize,
      photoId: idByEid.get(eidBySupervisor.get(s.supervisorName) ?? "") ?? null,
    })),
  );

  // Six ids at most, asked for after the podium is settled rather than for
  // the whole roster before it.
  const versions = await photoVersionsFor([...agents, ...supervisors]);
  return {
    monthStart: month.start,
    agents: withPhotoVersions(agents, versions),
    supervisors: withPhotoVersions(supervisors, versions),
  };
}

async function photoVersionsFor(people: PodiumPerson[]): Promise<Record<string, number>> {
  const ids = [...new Set(people.map((p) => p.photoId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return {};

  const rows = await db
    .select({ employeeId: employees.id, updatedAt: userAvatars.updatedAt })
    .from(employees)
    .innerJoin(userAvatars, eq(userAvatars.userId, employees.userId))
    .where(inArray(employees.id, ids));

  return Object.fromEntries(rows.map((row) => [row.employeeId, row.updatedAt.getTime()]));
}
