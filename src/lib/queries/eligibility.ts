import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { CACHE_TAG, cachedRead } from "@/lib/cache";
import { db } from "@/lib/db/client";
import {
  employeeAssignments,
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
 * Two sources, the earlier date winning where both speak. An EWS assessment
 * carrying a separating tag: attritionDate is the anchor, and the
 * assessment's own week stands in when nobody filled it, because a
 * separation with no date is still a separation and defaulting to "never"
 * would silently keep them in every future month. And the assignment
 * history: the imports always leave a person's newest interval open, so a
 * newest interval that is closed means a masterlist recorded them as gone
 * (planMasterlistCommit closes anyone missing from the month's roster on
 * the day before it starts), and its last day is when they left.
 */
export async function separationDates(employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();

  const [tagged, newest] = await Promise.all([
    // The newest assessment that CARRIES a separating tag, not the newest
    // assessment. Those differ: a supervisor filling in a later week leaves an
    // untagged row on top, and taking that row would silently un-separate
    // someone who has left — putting them back into every month's reporting.
    db
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
      .orderBy(ewsAssessments.employeeId, desc(ewsAssessments.week)),
    db
      .selectDistinctOn([employeeAssignments.employeeId], {
        employeeId: employeeAssignments.employeeId,
        effectiveTo: employeeAssignments.effectiveTo,
      })
      .from(employeeAssignments)
      .where(inArray(employeeAssignments.employeeId, employeeIds))
      .orderBy(employeeAssignments.employeeId, desc(employeeAssignments.effectiveFrom)),
  ]);

  return mergeSeparations(
    tagged.map((row) => ({ employeeId: row.employeeId, on: row.attritionDate ?? row.week })),
    newest,
  );
}

/**
 * The pure half of separationDates: one date per employee from the tagged
 * assessments and the newest assignment intervals, the earlier winning. An
 * open newest interval says nothing — they are still here as far as the
 * roster knows.
 */
export function mergeSeparations(
  tagged: Array<{ employeeId: string; on: string }>,
  newestIntervals: Array<{ employeeId: string; effectiveTo: string | null }>,
): Map<string, string> {
  const dates = new Map<string, string>();
  const note = (employeeId: string, on: string) => {
    const prior = dates.get(employeeId);
    if (prior === undefined || on < prior) dates.set(employeeId, on);
  };
  for (const row of tagged) note(row.employeeId, row.on);
  for (const row of newestIntervals) if (row.effectiveTo !== null) note(row.employeeId, row.effectiveTo);
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
/**
 * Sums each employee's production hours from raw fact rows, but only the
 * rows before that employee's own cutoff date.
 *
 * Pulled out of `eligibleForPeriod` as a pure function so the per-employee
 * cutoff logic — the exact thing that used to be a separate SQL query per
 * person — can be pinned down in a test with plain fixture rows, rather than
 * only exercised through a live database.
 */
export function hoursBeforeCutoff(
  rows: Array<{ employeeId: string; factDate: string; hours: number }>,
  cutoffById: Map<string, string>,
): Map<string, number> {
  const hours = new Map<string, number>();
  for (const row of rows) {
    const cutoff = cutoffById.get(row.employeeId);
    if (cutoff === undefined || row.factDate >= cutoff) continue;
    hours.set(row.employeeId, (hours.get(row.employeeId) ?? 0) + row.hours);
  }
  return hours;
}

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

  // Each person needs their own upper bound — the day they left — which
  // rules out one grouped SUM in SQL (a GROUP BY has one shared filter for
  // every row, not a per-employee one). Fetching the raw rows once — bounded
  // by the period, the loosest upper bound any of them can have — and
  // summing per person in JS (hoursBeforeCutoff, above) gets the same
  // per-employee cutoff without paying a separate round trip for each of
  // them; it was one query per person before, now it is one query total no
  // matter how many there are.
  const hours =
    needHours.length > 0
      ? hoursBeforeCutoff(
          await db
            .select({
              employeeId: skillFacts.employeeId,
              factDate: skillFacts.factDate,
              hours: skillFacts.hours,
            })
            .from(skillFacts)
            .where(
              and(
                inArray(skillFacts.employeeId, needHours.map(([id]) => id)),
                gte(skillFacts.factDate, period.start),
                lt(skillFacts.factDate, period.end),
              ),
            ),
          new Map(needHours),
        )
      : new Map<string, number>();

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
  // Organisation-wide per period and cached (five reads across four fact
  // tables), then narrowed here: the answer for one person does not depend
  // on who else is being asked about, and it changes only on import.
  const reporting = new Set(await readReportingEmployeeIds(period.start, period.end));
  return new Set(employeeIds.filter((id) => reporting.has(id)));
}

const readReportingEmployeeIds = cachedRead(
  "reporting-employees",
  [CACHE_TAG.imports],
  async (start: string, end: string): Promise<string[]> => {
    const [attendanceKpi] = await db
      .select({ id: kpiDefinitions.id })
      .from(kpiDefinitions)
      .where(eq(kpiDefinitions.code, "ATTENDANCE"))
      .limit(1);

    const [skillRows, qualityRows, npsRows, metricRows] = await Promise.all([
      db
        .selectDistinct({ id: skillFacts.employeeId })
        .from(skillFacts)
        .where(and(gte(skillFacts.factDate, start), lte(skillFacts.factDate, end))),
      db
        .selectDistinct({ id: qualityFacts.employeeId })
        .from(qualityFacts)
        .where(and(gte(qualityFacts.factDate, start), lte(qualityFacts.factDate, end))),
      db
        .selectDistinct({ id: npsFacts.employeeId })
        .from(npsFacts)
        .where(and(gte(npsFacts.factDate, start), lte(npsFacts.factDate, end))),
      db
        .selectDistinct({ id: metricFacts.employeeId })
        .from(metricFacts)
        .where(
          and(
            gte(metricFacts.factDate, start),
            lte(metricFacts.factDate, end),
            attendanceKpi ? ne(metricFacts.kpiId, attendanceKpi.id) : undefined,
          ),
        ),
    ]);

    const reporting = new Set<string>();
    for (const row of [...skillRows, ...qualityRows, ...npsRows, ...metricRows]) reporting.add(row.id);
    return [...reporting];
  },
);
