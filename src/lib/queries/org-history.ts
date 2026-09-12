import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
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

/** An inclusive date range. Any `Period` satisfies this structurally. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * A derived table: for each employee, the org structure that held them for
 * the MOST DAYS within `period` — not merely whoever held them on the last
 * day of it.
 *
 * A single end-date snapshot was the original rule, and it has a real
 * failure mode: someone who moves teams on the 29th of a 31-day month hands
 * the whole month's results to their new supervisor, who actually managed
 * three days of it, while the supervisor who ran the other twenty-eight
 * gets nothing. Summing days per candidate and taking the largest total
 * fixes that, while keeping the same guarantee the single-date rule gave —
 * exactly one owner per person per period, so a figure is never counted
 * twice toward two different supervisors.
 *
 * Two aggregation stages, not one, because a single supervisor's tenure is
 * sometimes recorded as several adjacent assignment rows rather than one
 * continuous interval: the workbook does not always carry a supervisor EID,
 * and a week where it's blank does not `sameOrg()` with a week where it
 * isn't, so the import's own interval-collapsing cannot merge them even
 * though the supervisor's name never changed. Grouping by
 * (employeeId, supervisorName, managerName, site) before summing heals
 * that — rows that are really one tenure, split only by a blank EID column,
 * are counted as one candidate rather than several small ones that each
 * lose to a genuinely different supervisor's single larger block.
 *
 * Ties (equal day counts) resolve to whichever candidate's stint starts
 * earliest, for a deterministic answer rather than one that depends on scan
 * order.
 */
export function periodOwnerSubquery(period: DateRange) {
  const overlapDays = sql<number>`
    (least(coalesce(${employeeAssignments.effectiveTo}, ${period.end}::date), ${period.end}::date)
     - greatest(${employeeAssignments.effectiveFrom}, ${period.start}::date) + 1)
  `.as("overlap_days");

  const stints = db
    .select({
      employeeId: employeeAssignments.employeeId,
      supervisorEid: employeeAssignments.supervisorEid,
      supervisorName: employeeAssignments.supervisorName,
      managerName: employeeAssignments.managerName,
      site: employeeAssignments.site,
      effectiveFrom: employeeAssignments.effectiveFrom,
      overlapDays,
    })
    .from(employeeAssignments)
    .where(
      and(
        lte(employeeAssignments.effectiveFrom, period.end),
        or(isNull(employeeAssignments.effectiveTo), gte(employeeAssignments.effectiveTo, period.start)),
      ),
    )
    .as("stints");

  const totals = db
    .select({
      employeeId: stints.employeeId,
      // Best-effort: at least one of the fragments sharing this identity
      // usually carries the EID even on weeks where the others don't.
      supervisorEid: sql<string | null>`max(${stints.supervisorEid})`.as("supervisor_eid"),
      supervisorName: stints.supervisorName,
      managerName: stints.managerName,
      site: stints.site,
      totalDays: sql<number>`sum(${stints.overlapDays})`.as("total_days"),
      earliestStart: sql<string>`min(${stints.effectiveFrom})`.as("earliest_start"),
    })
    .from(stints)
    .groupBy(stints.employeeId, stints.supervisorName, stints.managerName, stints.site)
    .as("totals");

  // The EID a supervisor's name carries everywhere else in the history, for
  // a stint that names them without one — a sheet with a Supervisor column
  // and no Sup EID column, read last for that week. Every match on a leader
  // is on the EID, so without this such a stint reached nobody: one
  // leader's August read 6 agents against the 26 her files named. The
  // most frequent EID for the exact name string; a name never seen with an
  // EID stays unresolved.
  const eidByName = db
    .select({
      supervisorName: employeeAssignments.supervisorName,
      eid: sql<string>`mode() within group (order by ${employeeAssignments.supervisorEid})`.as("eid"),
    })
    .from(employeeAssignments)
    .where(and(isNotNull(employeeAssignments.supervisorName), isNotNull(employeeAssignments.supervisorEid)))
    .groupBy(employeeAssignments.supervisorName)
    .as("eid_by_name");

  // Everyone whose history reaches the period at all. Someone here with no
  // stint above was closed out before the period started — the only way an
  // interval ends without a newer one taking over is a masterlist recording
  // them as gone (see planMasterlistCommit) — and belongs to nobody for it.
  // Without this row the *OfRecord fallbacks below would hand them to
  // whoever their current row still names, so a supervisor's September
  // team kept everyone the September masterlist had marked attrited.
  const reached = db
    .selectDistinct({ employeeId: employeeAssignments.employeeId })
    .from(employeeAssignments)
    .where(lte(employeeAssignments.effectiveFrom, period.end))
    .as("reached");

  return db
    .selectDistinctOn([reached.employeeId], {
      employeeId: reached.employeeId,
      supervisorEid: sql<string | null>`coalesce(${totals.supervisorEid}, ${eidByName.eid})`.as("supervisor_eid"),
      supervisorName: totals.supervisorName,
      managerName: totals.managerName,
      site: totals.site,
      totalDays: totals.totalDays,
      /** History reaches the period, but no day of it is covered: gone before it began. */
      closed: sql<boolean>`${totals.employeeId} is null`.as("closed"),
    })
    .from(reached)
    .leftJoin(totals, eq(totals.employeeId, reached.employeeId))
    .leftJoin(eidByName, eq(eidByName.supervisorName, totals.supervisorName))
    .orderBy(reached.employeeId, sql`${totals.totalDays} desc nulls last`, totals.earliestStart)
    .as("period_owner");
}

export type PeriodOwner = ReturnType<typeof periodOwnerSubquery>;

/** Join condition attaching a period-owner subquery to `employees`. */
export function joinPeriodOwner(owner: PeriodOwner): SQL {
  return eq(owner.employeeId, employees.id);
}

/**
 * Structure as of the period, falling back to the current row.
 *
 * The fallback covers anyone whose assignment history does not reach the
 * period at all — someone who joined after it, or data that predates this
 * table. It degrades to exactly the behaviour the app had before
 * assignments existed, rather than to a null that would drop them out of a
 * grouping entirely.
 *
 * It does not cover anyone whose history reaches the period and was closed
 * before it (`closed` on the owner row): the masterlist said they were gone,
 * and their current row — untouched since, still naming their last
 * supervisor — is exactly what must not stand in. They resolve to null and
 * so to nobody's team, nobody's site, nobody's manager for that period.
 *
 * `"period_owner"."closed"` and `"period_owner"."supervisor_eid"` are
 * hardcoded rather than interpolated from `owner`: every other field on
 * `owner` is a genuine column passed through unchanged from
 * `employee_assignments`, but those two originate as raw `sql` expressions
 * (an `is null` test and a `max(...)`) inside periodOwnerSubquery. Drizzle
 * correctly re-qualifies a real column reference across nested subqueries;
 * a field that originates as a raw `sql` expression loses that qualification
 * by the time it reaches a THIRD layer and renders bare — ambiguous the
 * moment this joins against `employees`, which has a same-named
 * `supervisor_eid` of its own. Safe to hardcode: "period_owner" is the
 * literal alias periodOwnerSubquery itself gives its outermost `.as(...)`
 * call, not something that can drift out from under this independently.
 */
function unlessClosed(current: SQL | AnyColumn): SQL {
  return sql`case when ${sql.raw('"period_owner"."closed"')} then null else ${current} end`;
}
export function siteOfRecord(owner: PeriodOwner) {
  return sql<string | null>`coalesce(${owner.site}, ${unlessClosed(employees.site)})`;
}
export function managerOfRecord(owner: PeriodOwner) {
  return sql<string | null>`coalesce(${owner.managerName}, ${unlessClosed(employees.managerName)})`;
}
export function supervisorOfRecord(owner: PeriodOwner) {
  return sql<string | null>`coalesce(${owner.supervisorName}, ${unlessClosed(employees.supervisorName)})`;
}
export function supervisorEidOfRecord(owner: PeriodOwner) {
  void owner;
  return sql<string | null>`coalesce(${sql.raw('"period_owner"."supervisor_eid"')}, ${unlessClosed(employees.supervisorEid)})`;
}

/**
 * Employee ids whose results belong to this leader for `period`.
 *
 * One rule, used for both scoping and grouping: a person's results belong
 * to whoever held them the most days of the period being viewed — see
 * periodOwnerSubquery for why that beats a single end-date snapshot.
 *
 * Fails closed exactly as the operational scope does: an unlinked account
 * resolves to nobody rather than to everybody.
 */
export async function reportingScopeIds(user: CurrentUser, period: DateRange): Promise<string[]> {
  if (user.role === "admin" || user.role === "agent") return resolveScopedIds(user);

  const owner = periodOwnerSubquery(period);

  const match =
    user.role === "manager"
      ? eq(managerOfRecord(owner), user.managerName ?? user.name)
      : user.employeeEid
        ? eq(supervisorEidOfRecord(owner), user.employeeEid)
        : null;

  // A supervisor with no linked employee id cannot be matched to anyone, which
  // is the same nobody the operational scope grants them.
  if (match === null) return [];

  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
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
 * A point-in-time question, deliberately distinct from the period-owner
 * rule above: "who supervised them on this one day" does not have the
 * fragmented-tenure or split-credit problem a whole period does, since a
 * single date can only ever fall inside one assignment interval.
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
