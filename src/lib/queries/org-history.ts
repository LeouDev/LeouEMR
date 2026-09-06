import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeAssignments, employees } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { resolveScopedIds } from "@/lib/queries/performance";

/**
 * Reporting scope, as opposed to operational scope.
 *
 * Two different questions get two different answers, and conflating them is
 * what made a realignment rewrite history:
 *
 *   "whose record may I open, whose leave may I approve?"  -> employees, now
 *   "whose numbers make up my team's August?"              -> assignments, then
 *
 * `resolveScopedIds` answers the first and stays the basis for authorization.
 * These answer the second, so August's results stay with August's supervisor
 * even after the org moves underneath them.
 */

/**
 * Employee ids whose results belong to this leader for a period ending `asOf`.
 *
 * One rule, used for both scoping and grouping: a person's results belong to
 * whoever they reported to at the END of the period being viewed. Viewing
 * August therefore asks who held them on 31 August, which is the supervisor
 * who actually managed that month's work — not whoever holds them today.
 *
 * A single date rather than an overlap test on purpose. Overlap would place
 * someone who moved mid-period on two supervisors' teams at once, so a figure
 * would be counted twice and two managers would each believe the result was
 * theirs. One date gives every person exactly one owner per period.
 *
 * Fails closed exactly as the operational scope does: an unlinked account
 * resolves to nobody rather than to everybody.
 */
export async function reportingScopeIds(user: CurrentUser, asOf: string): Promise<string[]> {
  if (user.role === "admin" || user.role === "agent") return resolveScopedIds(user);

  const match =
    user.role === "manager"
      ? eq(managerOfRecord, user.managerName ?? user.name)
      : user.employeeEid
        ? eq(supervisorEidOfRecord, user.employeeEid)
        : null;

  // A supervisor with no linked employee id cannot be matched to anyone, which
  // is the same nobody the operational scope grants them.
  if (match === null) return [];

  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .leftJoin(employeeAssignments, assignmentAt(asOf))
    .where(match);
  return rows.map((r) => r.id);
}

export interface OrgOfRecord {
  supervisorEid: string | null;
  supervisorName: string | null;
  managerName: string | null;
  site: string | null;
}

/**
 * Who each person reported to on `date`, falling back to their current row.
 *
 * The fallback matters for anyone whose history does not reach back that far —
 * someone who joined after the date, or data imported before this table
 * existed. Showing their present supervisor is better than showing a blank,
 * and it is exactly what the app displayed before assignments were recorded.
 */
export async function orgOfRecord(
  employeeIds: string[],
  date: string,
): Promise<Map<string, OrgOfRecord>> {
  const out = new Map<string, OrgOfRecord>();
  if (employeeIds.length === 0) return out;

  const [assigned, current] = await Promise.all([
    db
      .select({
        employeeId: employeeAssignments.employeeId,
        supervisorEid: employeeAssignments.supervisorEid,
        supervisorName: employeeAssignments.supervisorName,
        managerName: employeeAssignments.managerName,
        site: employeeAssignments.site,
      })
      .from(employeeAssignments)
      .where(
        and(
          inArray(employeeAssignments.employeeId, employeeIds),
          lte(employeeAssignments.effectiveFrom, date),
          or(isNull(employeeAssignments.effectiveTo), gte(employeeAssignments.effectiveTo, date)),
        ),
      ),
    db
      .select({
        employeeId: employees.id,
        supervisorEid: employees.supervisorEid,
        supervisorName: employees.supervisorName,
        managerName: employees.managerName,
        site: employees.site,
      })
      .from(employees)
      .where(inArray(employees.id, employeeIds)),
  ]);

  for (const row of current) out.set(row.employeeId, row);
  // Assignments are disjoint by database constraint, so at most one row per
  // person can match and this overwrite is unambiguous.
  for (const row of assigned) out.set(row.employeeId, row);
  return out;
}

/**
 * Join condition selecting the assignment that covers `date`.
 *
 * Paired with a LEFT JOIN and the `*OfRecord` expressions below, this turns
 * any query that groups by supervisor, manager or site into one that groups by
 * who held that role at the time. The database guarantees assignments are
 * disjoint, so the join can never fan out and inflate a count.
 */
export function assignmentAt(date: string) {
  return and(
    eq(employeeAssignments.employeeId, employees.id),
    lte(employeeAssignments.effectiveFrom, date),
    or(isNull(employeeAssignments.effectiveTo), gte(employeeAssignments.effectiveTo, date)),
  );
}

/**
 * Structure as of the joined date, falling back to the current row.
 *
 * The fallback covers anyone whose history does not reach the date — someone
 * who joined later, or data that predates this table. It degrades to exactly
 * the behaviour the app had before assignments existed, rather than to a null
 * that would drop them out of a grouping entirely.
 */
export const siteOfRecord = sql<
  string | null
>`coalesce(${employeeAssignments.site}, ${employees.site})`;

export const managerOfRecord = sql<
  string | null
>`coalesce(${employeeAssignments.managerName}, ${employees.managerName})`;

export const supervisorOfRecord = sql<
  string | null
>`coalesce(${employeeAssignments.supervisorName}, ${employees.supervisorName})`;

export const supervisorEidOfRecord = sql<
  string | null
>`coalesce(${employeeAssignments.supervisorEid}, ${employees.supervisorEid})`;
