import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employees,
  ewsAssessments,
  kpiDefinitions,
  metricFacts,
  npsFacts,
  qualityFacts,
  skillFacts,
} from "@/lib/db/schema";
import type { Period } from "./period";

/**
 * Production hours a separated employee must have worked in the period their
 * separation falls in to still count for it.
 *
 * Someone who left on the 22nd worked most of that month and belongs in its
 * numbers; someone who left on the 2nd does not, and including them drags a
 * team's averages down with a fortnight of absence they were never there for.
 * Thirty hours is the line the business draws.
 */
export const MIN_PRODUCTION_HOURS = 30;

/** Attrition tags that end employment, as opposed to pausing it. */
const SEPARATING = ["black", "absconding"] as const;

/**
 * When each of these employees separated, for those who have.
 *
 * Read from the latest EWS assessment carrying a separating tag. attritionDate
 * is the anchor; the assessment's own week stands in when nobody filled it,
 * because a separation with no date is still a separation and defaulting to
 * "never" would silently keep them in every future month.
 */
export async function separationDates(employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();

  // The newest assessment that CARRIES a separating tag, not the newest
  // assessment. Those differ: a supervisor filling in a later week leaves an
  // untagged row on top, and taking that row would silently un-separate
  // someone who has left — putting them back into every month's reporting.
  const rows = await db
    .selectDistinctOn([ewsAssessments.employeeId], {
      employeeId: ewsAssessments.employeeId,
      attritionDate: ewsAssessments.attritionDate,
      week: ewsAssessments.week,
    })
    .from(ewsAssessments)
    .where(
      and(
        inArray(ewsAssessments.employeeId, employeeIds),
        inArray(ewsAssessments.attrition, [...SEPARATING]),
      ),
    )
    .orderBy(ewsAssessments.employeeId, desc(ewsAssessments.week));

  const dates = new Map<string, string>();
  for (const row of rows) dates.set(row.employeeId, row.attritionDate ?? row.week);
  return dates;
}

/**
 * Whether a separated employee still counts for one reporting period.
 *
 * Evaluated per period against the separation date, never against the
 * employee's status today. That distinction is the whole point: a status is a
 * fact about now, and using it to decide what August looked like means August
 * changes every time someone resigns. Re-opening a past month has to give the
 * same answer it gave last week.
 *
 * Three cases. A period that ended before they left is untouched — their
 * results stand exactly as reported. A period that starts after they left
 * excludes them; they were not there. Only the period their separation falls
 * inside is judged on hours worked, and only that one.
 */
export function eligibilityFor(
  period: Period,
  separatedOn: string,
  /** Production hours between the period's start and the separation date. */
  hoursBeforeSeparation: number,
): boolean {
  if (period.end < separatedOn) return true;
  if (period.start > separatedOn) return false;
  return hoursBeforeSeparation > MIN_PRODUCTION_HOURS;
}

/**
 * Narrows a set of employees to those who count for a reporting period.
 *
 * Everyone who has not separated passes through untouched — the thirty-hour
 * test is not a general eligibility gate, and applying it to active people
 * would drop every new hire still ramping and everyone who took a week off.
 */
export async function eligibleForPeriod(
  employeeIds: string[],
  period: Period,
): Promise<string[]> {
  if (employeeIds.length === 0) return [];

  const separated = await separationDates(employeeIds);
  if (separated.size === 0) return employeeIds;

  // Only the people whose separation lands inside this period need their
  // hours counted; the rest are decided by date alone.
  const needHours = [...separated.entries()].filter(
    ([, on]) => on >= period.start && on <= period.end,
  );

  // Each person needs their own upper bound — the day they left — so this
  // cannot be one grouped query. It is at most a handful of people: only
  // those whose separation lands inside this exact period.
  const hours = new Map<string, number>();
  for (const [id, on] of needHours) {
    const [row] = await db
      .select({ hours: sql<number>`coalesce(sum(${skillFacts.hours}), 0)::double precision` })
      .from(skillFacts)
      .where(
        and(
          eq(skillFacts.employeeId, id),
          gte(skillFacts.factDate, period.start),
          lt(skillFacts.factDate, on),
        ),
      );
    hours.set(id, row?.hours ?? 0);
  }

  return employeeIds.filter((id) => {
    const on = separated.get(id);
    if (!on) return true;
    return eligibilityFor(period, on, hours.get(id) ?? 0);
  });
}

/** Employees currently separated or on leave, for the roster views that want to say so. */
export async function currentlyAway(): Promise<Set<string>> {
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(sql`${employees.status} <> 'active'`);
  return new Set(rows.map((r) => r.id));
}


/**
 * Employees with at least one row of REAL production data in a period.
 *
 * A distinct dimension from `eligibleForPeriod` above, and deliberately not
 * merged into it: that one asks whether someone had separated, this one asks
 * whether someone had started producing anything measurable yet. A new hire
 * still in Nesting, someone on an approved leave, or an SME carrying no book
 * of work all show up in the weekly import with nothing but an attendance
 * mark — no skill facts, no quality audits, no NPS responses, no other
 * scored metric. They have not yet reported to anyone in a way MBO, CPH, AHT
 * or a supervisor's headcount can measure, so counting them inflates every
 * one of those figures with people who cannot pass or fail anything.
 *
 * Attendance itself is excluded from what counts as "data" here on purpose:
 * it is the one metric everyone gets from the moment they are scheduled, so
 * treating it as evidence of reporting would defeat the whole point of this
 * check — it is exactly the row a training/LOA/SME employee has and nothing
 * else.
 */
export async function hasReportableData(
  employeeIds: string[],
  period: Period,
): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();

  const [attendanceKpi] = await db
    .select({ id: kpiDefinitions.id })
    .from(kpiDefinitions)
    .where(eq(kpiDefinitions.code, "ATTENDANCE"))
    .limit(1);

  const [skillRows, qualityRows, npsRows, metricRows] = await Promise.all([
    db
      .selectDistinct({ id: skillFacts.employeeId })
      .from(skillFacts)
      .where(
        and(
          inArray(skillFacts.employeeId, employeeIds),
          gte(skillFacts.factDate, period.start),
          lte(skillFacts.factDate, period.end),
        ),
      ),
    db
      .selectDistinct({ id: qualityFacts.employeeId })
      .from(qualityFacts)
      .where(
        and(
          inArray(qualityFacts.employeeId, employeeIds),
          gte(qualityFacts.factDate, period.start),
          lte(qualityFacts.factDate, period.end),
        ),
      ),
    db
      .selectDistinct({ id: npsFacts.employeeId })
      .from(npsFacts)
      .where(
        and(
          inArray(npsFacts.employeeId, employeeIds),
          gte(npsFacts.factDate, period.start),
          lte(npsFacts.factDate, period.end),
        ),
      ),
    db
      .selectDistinct({ id: metricFacts.employeeId })
      .from(metricFacts)
      .where(
        and(
          inArray(metricFacts.employeeId, employeeIds),
          gte(metricFacts.factDate, period.start),
          lte(metricFacts.factDate, period.end),
          attendanceKpi ? ne(metricFacts.kpiId, attendanceKpi.id) : undefined,
        ),
      ),
  ]);

  const reporting = new Set<string>();
  for (const row of [...skillRows, ...qualityRows, ...npsRows, ...metricRows]) reporting.add(row.id);
  return reporting;
}
