import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, ewsAssessments, ewsHeadcount, ewsIndicators, users } from "@/lib/db/schema";
import { employeeScope, withScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import {
  autoMetricsByEmployee,
  deriveAutoIndicators,
  EMPTY_AUTO_METRICS,
  type AutoIndicator,
  type AutoIndicatorCode,
} from "@/lib/ews/auto-indicators";
import type { EwsAttrition } from "@/lib/ews/engine";
import { headcountChain, headcountStats, sumChains, type HeadcountEntry, type HeadcountMonth, type HeadcountStats } from "@/lib/ews/headcount";
import { buildRosterRow, rosterTotals, sortRoster, type EwsRosterRow, type RosterTotals } from "@/lib/ews/roster";
import { separatedBefore } from "./eligibility";
import { joinPeriodOwner, periodOwnerSubquery, reportingScopeIds, supervisorEidOfRecord, supervisorOfRecord } from "./org-history";
import { getFactDateRange, getPeriodMetrics } from "./period-metrics";
import { periodContaining, previousPeriod, weekContaining, type Period } from "./period";

/** A team leader as the roster scope knows them: the EID the rows carry and the name to show. */
export interface EwsTeam {
  supervisorEid: string;
  supervisorName: string;
}

/**
 * The team leaders in the caller's scope, by name. A supervisor's list is
 * just themselves; a manager's is their span; an administrator's is
 * everyone with a team. Read from the current roster, the same key every
 * EWS page narrows on — one entry per EID, whatever spellings of the name
 * the rows carry, the commonest spelling shown.
 */
export async function getEwsTeams(user: CurrentUser): Promise<EwsTeam[]> {
  const scope = employeeScope(user);
  if (scope === null) return [];
  const rows = await db
    .select({ supervisorEid: employees.supervisorEid, supervisorName: employees.supervisorName, n: sql<number>`count(*)` })
    .from(employees)
    .where(scope === "all" ? undefined : scope)
    .groupBy(employees.supervisorEid, employees.supervisorName);
  const byEid = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    if (r.supervisorEid === null) continue;
    const n = Number(r.n);
    const current = byEid.get(r.supervisorEid);
    if (!current || (r.supervisorName !== null && (current.n < n || current.name === r.supervisorEid))) {
      byEid.set(r.supervisorEid, { name: r.supervisorName ?? current?.name ?? r.supervisorEid, n });
    }
  }
  return [...byEid.entries()]
    .map(([supervisorEid, { name }]) => ({ supervisorEid, supervisorName: name }))
    .sort((a, b) => a.supervisorName.localeCompare(b.supervisorName));
}

/**
 * The week whose figures the tracker reads and writes against: the latest
 * imported one. Null before the first import, when there is nothing to
 * derive from and an assessment is keyed on today's week instead.
 */
export async function ewsDataWeek(): Promise<Period | null> {
  const range = await getFactDateRange();
  return range ? periodContaining("week", range.last) : null;
}

/** The week an assessment saved today is keyed on. */
export async function ewsAssessmentWeek(today: string): Promise<string> {
  const data = await ewsDataWeek();
  return data?.start ?? weekContaining(today).start;
}

/**
 * The three data-derived indicators for each person, for a week: that
 * week's attendance and PAR, and its quality and NPS against the week
 * before. Someone with no figures gets every flag off.
 */
export async function autoIndicatorsFor(
  employeeIds: string[],
  week: Period,
): Promise<Map<string, Record<AutoIndicatorCode, AutoIndicator>>> {
  const out = new Map<string, Record<AutoIndicatorCode, AutoIndicator>>();
  if (employeeIds.length === 0) return out;
  const [current, previous] = await Promise.all([
    getPeriodMetrics(employeeIds, week),
    getPeriodMetrics(employeeIds, previousPeriod(week)),
  ]);
  const metrics = autoMetricsByEmployee(current, previous);
  for (const id of employeeIds) out.set(id, deriveAutoIndicators(metrics.get(id) ?? EMPTY_AUTO_METRICS));
  return out;
}

export interface EwsRoster {
  rows: EwsRosterRow[];
  totals: RosterTotals;
  /** The week the derived indicators read; null before the first import. */
  dataWeek: Period | null;
  /** Active indicators in display order, the form's list. */
  indicators: Array<{ code: string; label: string }>;
}

const EMPTY_ROSTER: EwsRoster = {
  rows: [],
  totals: { black: 0, red: 0, yellow: 0, green: 0, size: 0 },
  dataWeek: null,
  indicators: [],
};

interface RosterPerson {
  id: string;
  eid: string;
  name: string;
  supervisorEid: string | null;
  supervisorName: string | null;
}

/**
 * The people on a team leader's roster for one month: whoever the org
 * history says the leader held for the most days of it, not counting
 * anyone the masterlist closed before it or an EWS tag separated before
 * it began. Someone who leaves mid-month stays on the month's roster —
 * they were on it — and drops off with the next one.
 *
 * The month's supervisor of record is what the Team column shows and what
 * a team narrows on, so a realignment moves people between rosters on the
 * month it took effect, not retroactively.
 */
async function monthRoster(user: CurrentUser, team: string | null, month: Period): Promise<RosterPerson[]> {
  const [ids, gone] = await Promise.all([reportingScopeIds(user, month), separatedBefore(month.start)]);
  if (ids.length === 0) return [];
  const owner = periodOwnerSubquery(month);
  const supervisorEid = supervisorEidOfRecord(owner);
  const rows = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      supervisorEid,
      supervisorName: supervisorOfRecord(owner),
    })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(and(inArray(employees.id, ids), team ? eq(supervisorEid, team) : isNotNull(supervisorEid)))
    .orderBy(employees.name);
  return rows.filter((r) => !gone.has(r.id));
}

/**
 * Everyone the caller's operational scope reaches — or on one team of it
 * by their current row — whether or not they are still on a roster. What
 * the attrition screen lists: an exit belongs to the leader who last held
 * the person, whichever month they left.
 */
async function everyoneInScope(user: CurrentUser, team: string | null): Promise<RosterPerson[]> {
  const where = withScope(user, team ? eq(employees.supervisorEid, team) : undefined);
  if (where === null) return [];
  return db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      supervisorEid: employees.supervisorEid,
      supervisorName: employees.supervisorName,
    })
    .from(employees)
    .where(where)
    .orderBy(employees.name);
}

/**
 * The roster with everyone's live risk, worst first (see
 * src/lib/ews/roster.ts for what "live" means): the team leader's people
 * for `month` when one is given, or everyone the caller's scope reaches
 * when not (the attrition screen's read).
 *
 * Someone who has never been assessed is listed anyway, scored on the
 * data alone: an unassessed employee is a coverage gap a supervisor should
 * see and close, not something to quietly omit until it becomes a score.
 */
export async function getEwsRoster(user: CurrentUser, team: string | null, month: Period | null): Promise<EwsRoster> {
  const [roster, indicators, dataWeek] = await Promise.all([
    month ? monthRoster(user, team, month) : everyoneInScope(user, team),
    db
      .select({ code: ewsIndicators.code, label: ewsIndicators.label })
      .from(ewsIndicators)
      .where(eq(ewsIndicators.active, true))
      .orderBy(asc(ewsIndicators.sortOrder)),
    ewsDataWeek(),
  ]);
  if (roster.length === 0) return { ...EMPTY_ROSTER, indicators, dataWeek };
  const ids = roster.map((r) => r.id);

  // The two most recent assessments per person: the latest is the record,
  // the one before it is what the trend column compares with. A window
  // rather than two DISTINCT ON reads, so it is one pass over the table.
  const ranked = db
    .select({
      id: ewsAssessments.id,
      employeeId: ewsAssessments.employeeId,
      week: ewsAssessments.week,
      indicators: ewsAssessments.indicators,
      capActive: ewsAssessments.capActive,
      attrition: ewsAssessments.attrition,
      attritionDate: ewsAssessments.attritionDate,
      expectedReturn: ewsAssessments.expectedReturn,
      actionPlan: ewsAssessments.actionPlan,
      notes: ewsAssessments.notes,
      score: ewsAssessments.score,
      updatedAt: ewsAssessments.updatedAt,
      assessedBy: ewsAssessments.assessedBy,
      rank: sql<number>`row_number() over (partition by ${ewsAssessments.employeeId} order by ${ewsAssessments.week} desc)`.as("rank"),
    })
    .from(ewsAssessments)
    .where(inArray(ewsAssessments.employeeId, ids))
    .as("ranked");

  const [assessments, profiles, auto] = await Promise.all([
    db
      .select({
        employeeId: ranked.employeeId,
        week: ranked.week,
        indicators: ranked.indicators,
        capActive: ranked.capActive,
        attrition: ranked.attrition,
        attritionDate: ranked.attritionDate,
        expectedReturn: ranked.expectedReturn,
        actionPlan: ranked.actionPlan,
        notes: ranked.notes,
        score: ranked.score,
        updatedAt: ranked.updatedAt,
        rank: ranked.rank,
        assessedByName: users.name,
      })
      .from(ranked)
      .leftJoin(users, eq(users.id, ranked.assessedBy))
      .where(lte(ranked.rank, 2))
      .orderBy(ranked.employeeId, desc(ranked.week)),
    // The 201 file's position, for whoever has one. Read apart from the
    // roster rather than joined: a profile is keyed on the EID, not unique
    // on it, and a join would double a row for a duplicated file.
    db
      .select({ eid: employeeProfiles.employeeEid, position: employeeProfiles.position })
      .from(employeeProfiles)
      .where(inArray(employeeProfiles.employeeEid, roster.map((r) => r.eid))),
    dataWeek ? autoIndicatorsFor(ids, dataWeek) : Promise.resolve(new Map<string, Record<AutoIndicatorCode, AutoIndicator>>()),
  ]);

  const latestBy = new Map<string, (typeof assessments)[number]>();
  const previousScoreBy = new Map<string, number>();
  for (const a of assessments) {
    if (Number(a.rank) === 1) latestBy.set(a.employeeId, a);
    else previousScoreBy.set(a.employeeId, a.score);
  }
  const positionBy = new Map<string, string>();
  for (const p of profiles) if (!positionBy.has(p.eid)) positionBy.set(p.eid, p.position);

  const rows = sortRoster(
    roster.map((r) => {
      const a = latestBy.get(r.id);
      return buildRosterRow({
        employeeId: r.id,
        eid: r.eid,
        name: r.name,
        position: positionBy.get(r.eid) ?? null,
        supervisorEid: r.supervisorEid,
        supervisorName: r.supervisorName,
        latest: a
          ? {
              week: a.week,
              indicators: (a.indicators as Record<string, boolean>) ?? {},
              capActive: a.capActive,
              attrition: a.attrition as EwsAttrition,
              attritionDate: a.attritionDate,
              expectedReturn: a.expectedReturn,
              actionPlan: a.actionPlan,
              notes: a.notes,
              score: a.score,
              updatedAt: new Date(a.updatedAt).toISOString(),
              assessedByName: a.assessedByName,
            }
          : null,
        previousScore: previousScoreBy.get(r.id) ?? null,
        auto: auto.get(r.id) ?? deriveAutoIndicators(EMPTY_AUTO_METRICS),
      });
    }),
  );

  return { rows, totals: rosterTotals(rows), dataWeek, indicators };
}

export interface EwsHeadcountView {
  /** The twelve months, the one team's chain or every team's summed. */
  chain: HeadcountMonth[];
  stats: HeadcountStats;
  /** Which teams' rows are behind it. */
  teams: EwsTeam[];
}

/**
 * A year of headcount movement: one team's chain, or every team in scope
 * added up month by month when no team is picked. A month nobody has
 * recorded is zero movement.
 *
 * A team is a leader with reports today, or — for a supervisor picking
 * their own, and for an administrator, whose scope is everyone — one with
 * months recorded and nobody left: the leader whose last agent transferred
 * out still has that transfer to record, and their year still counts.
 */
export async function getEwsHeadcount(user: CurrentUser, year: number, team: string | null): Promise<EwsHeadcountView> {
  const allTeams = await getEwsTeams(user);
  let teams = team ? allTeams.filter((t) => t.supervisorEid === team) : allTeams;
  if (team && teams.length === 0 && (user.role === "admin" || (user.role === "supervisor" && user.employeeEid === team))) {
    teams = [{ supervisorEid: team, supervisorName: user.role === "supervisor" ? user.name : team }];
  }
  if (!team && user.role === "admin") {
    const known = new Set(teams.map((t) => t.supervisorEid));
    const recorded = await db
      .selectDistinct({ supervisorEid: ewsHeadcount.supervisorEid })
      .from(ewsHeadcount)
      .where(eq(ewsHeadcount.year, year));
    for (const r of recorded) {
      if (!known.has(r.supervisorEid)) teams = [...teams, { supervisorEid: r.supervisorEid, supervisorName: r.supervisorEid }];
    }
  }
  const empty = { chain: headcountChain([]), stats: headcountStats(headcountChain([])), teams };
  if (teams.length === 0) return empty;

  const rows = await db
    .select({
      supervisorEid: ewsHeadcount.supervisorEid,
      month: ewsHeadcount.month,
      openingOverride: ewsHeadcount.openingOverride,
      newHires: ewsHeadcount.newHires,
      transferIn: ewsHeadcount.transferIn,
      transferOut: ewsHeadcount.transferOut,
      voluntaryAttrition: ewsHeadcount.voluntaryAttrition,
      involuntaryAttrition: ewsHeadcount.involuntaryAttrition,
    })
    .from(ewsHeadcount)
    .where(and(inArray(ewsHeadcount.supervisorEid, teams.map((t) => t.supervisorEid)), eq(ewsHeadcount.year, year)));

  const byTeam = new Map<string, HeadcountEntry[]>();
  for (const r of rows) byTeam.set(r.supervisorEid, [...(byTeam.get(r.supervisorEid) ?? []), r]);
  const chains = teams.map((t) => headcountChain(byTeam.get(t.supervisorEid) ?? []));
  const chain = chains.length === 1 ? chains[0] : sumChains(chains);
  return { chain, stats: headcountStats(chain), teams };
}

export interface EwsRiskCounts {
  stable: number;
  watch: number;
  atRisk: number;
  critical: number;
  unassessed: number;
}

/**
 * Risk distribution as of a period's end date, org-wide — for a historical
 * or comparison read, unlike `getEwsRoster`'s always-latest "right now"
 * board. Everyone's most recent assessment recorded on or before the
 * period's end counts; an assessment made after that date does not, even
 * though the roster would already be showing it today. Someone with no
 * assessment that early counts as unassessed, same as the board does.
 */
export async function getEwsRiskCounts(period: Period): Promise<EwsRiskCounts> {
  const roster = await db.select({ id: employees.id }).from(employees);
  if (roster.length === 0) {
    return { stable: 0, watch: 0, atRisk: 0, critical: 0, unassessed: 0 };
  }
  const ids = roster.map((r) => r.id);

  const latest = await db
    .selectDistinctOn([ewsAssessments.employeeId], {
      employeeId: ewsAssessments.employeeId,
      riskLevel: ewsAssessments.riskLevel,
    })
    .from(ewsAssessments)
    .where(and(inArray(ewsAssessments.employeeId, ids), lte(ewsAssessments.week, period.end)))
    .orderBy(ewsAssessments.employeeId, desc(ewsAssessments.week));

  const counts: EwsRiskCounts = {
    stable: 0,
    watch: 0,
    atRisk: 0,
    critical: 0,
    unassessed: roster.length - latest.length,
  };
  for (const a of latest) {
    if (a.riskLevel === "BLACK") counts.critical += 1;
    else if (a.riskLevel === "RED") counts.atRisk += 1;
    else if (a.riskLevel === "YELLOW") counts.watch += 1;
    else if (a.riskLevel === "GREEN") counts.stable += 1;
  }
  return counts;
}
