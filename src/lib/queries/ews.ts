import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employees, ewsAssessments, users } from "@/lib/db/schema";
import { employeeScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import type { EwsAttrition, EwsRiskLevel } from "@/lib/ews/engine";
import type { Period } from "./period";

export interface EwsRow {
  employeeId: string;
  eid: string;
  employeeName: string;
  supervisorName: string | null;
  /** Null when nobody has ever assessed this person. */
  week: string | null;
  riskLevel: EwsRiskLevel | null;
  score: number | null;
  capActive: boolean;
  attrition: EwsAttrition | null;
  notes: string | null;
  assessedByName: string | null;
}

export interface EwsBoard {
  rows: EwsRow[];
  /**
   * Everyone whose latest assessment carries an attrition tag — separated or
   * on leave. Keyed off the assessment rather than employees.status so the
   * list is right even for someone tagged before the status write existed,
   * and so it cannot drift from the tag a supervisor actually set.
   */
  away: EwsRow[];
  totals: {
    black: number;
    red: number;
    yellow: number;
    green: number;
    /** In scope, with performance data, but never assessed. */
    unassessed: number;
  };
}

/** Worst first: an unassessed gap is itself worth surfacing, so it sorts above a clean record. */
const RISK_RANK: Record<string, number> = { BLACK: 0, RED: 1, YELLOW: 2, unassessed: 3, GREEN: 4 };

/**
 * Retention risk across the caller's scope, one row per person.
 *
 * Ported concept, not ported code: the risk itself is judged per employee on
 * their own page (`saveEwsAssessment`), which is the only place a score is
 * computed and written. This just surfaces the latest judgment for everyone
 * in scope side by side — the same shift from "one record at a time" to "a
 * board" that `getDevelopmentBoard` makes for action items.
 *
 * Someone who has never been assessed is listed anyway, with a null risk
 * level, because an unassessed employee is a coverage gap a supervisor should
 * see and close — not something to quietly omit until it becomes a score.
 */
export async function getEwsBoard(user: CurrentUser): Promise<EwsBoard> {
  const empty: EwsBoard = {
    rows: [],
    away: [],
    totals: { black: 0, red: 0, yellow: 0, green: 0, unassessed: 0 },
  };

  const scope = employeeScope(user);
  if (scope === null) return empty;

  const roster = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      supervisorName: employees.supervisorName,
    })
    .from(employees)
    .where(scope === "all" ? undefined : scope)
    .orderBy(employees.name);

  if (roster.length === 0) return empty;
  const ids = roster.map((r) => r.id);

  // One row per employee: their most recent assessment, whatever week it was
  // recorded for. This is a "who is at risk right now" board, not a report on
  // one specific week — a person assessed three weeks ago is still exactly as
  // assessed as one assessed yesterday.
  const latest = await db
    .selectDistinctOn([ewsAssessments.employeeId], {
      employeeId: ewsAssessments.employeeId,
      week: ewsAssessments.week,
      riskLevel: ewsAssessments.riskLevel,
      score: ewsAssessments.score,
      capActive: ewsAssessments.capActive,
      attrition: ewsAssessments.attrition,
      notes: ewsAssessments.notes,
      assessedByName: users.name,
    })
    .from(ewsAssessments)
    .leftJoin(users, eq(users.id, ewsAssessments.assessedBy))
    .where(inArray(ewsAssessments.employeeId, ids))
    .orderBy(ewsAssessments.employeeId, desc(ewsAssessments.week));

  const byEmployee = new Map(latest.map((a) => [a.employeeId, a]));

  const rows: EwsRow[] = roster
    .map((r) => {
      const a = byEmployee.get(r.id);
      return {
        employeeId: r.id,
        eid: r.eid,
        employeeName: r.name,
        supervisorName: r.supervisorName,
        week: a?.week ?? null,
        riskLevel: a?.riskLevel ?? null,
        score: a?.score ?? null,
        capActive: a?.capActive ?? false,
        attrition: a?.attrition ?? null,
        notes: a?.notes ?? null,
        assessedByName: a?.assessedByName ?? null,
      };
    })
    .sort((x, y) => {
      const rx = RISK_RANK[x.riskLevel ?? "unassessed"];
      const ry = RISK_RANK[y.riskLevel ?? "unassessed"];
      if (rx !== ry) return rx - ry;
      if ((y.score ?? -1) !== (x.score ?? -1)) return (y.score ?? -1) - (x.score ?? -1);
      return x.employeeName.localeCompare(y.employeeName);
    });

  const totals = { black: 0, red: 0, yellow: 0, green: 0, unassessed: 0 };
  for (const row of rows) {
    if (row.riskLevel === "BLACK") totals.black += 1;
    else if (row.riskLevel === "RED") totals.red += 1;
    else if (row.riskLevel === "YELLOW") totals.yellow += 1;
    else if (row.riskLevel === "GREEN") totals.green += 1;
    else totals.unassessed += 1;
  }

  // Sorted by name: this is a register of who is off the floor, not a
  // ranking — there is nothing to be worst at.
  const away = rows
    .filter((r) => r.attrition && r.attrition !== "none")
    .sort((x, y) => x.employeeName.localeCompare(y.employeeName));

  return { rows, away, totals };
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
 * or comparison read, unlike `getEwsBoard`'s always-latest "right now"
 * board. Everyone's most recent assessment recorded on or before the
 * period's end counts; an assessment made after that date does not, even
 * though `getEwsBoard` would already be showing it today. Someone with no
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
