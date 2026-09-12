import { and, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, employeeAssignments, employees } from "@/lib/db/schema";
import { closeIssuesOnSeparationFor } from "@/lib/action-item-engine/persistence";
import { periodContaining } from "@/lib/queries/period";
import { collapseWeeks, shiftDay, spliceAssignments, type Assignment, type OrgWeek } from "@/lib/org/assignments";
import { syncEmployeeSnapshots } from "@/lib/org/snapshot";
import type { ParsedMasterlistRow } from "./masterlist";

/** The month a masterlist upload speaks for, resolved from any date inside it. */
export function resolveMasterlistMonth(monthStart: string): { start: string; end: string; label: string } {
  const period = periodContaining("month", monthStart);
  return { start: period.start, end: period.end, label: period.label };
}

interface ActiveEmployee {
  id: string;
  eid: string;
  name: string;
}

/**
 * Employees whose assignment covers `asOfDate` — the roster a masterlist is
 * checked against for attrition.
 *
 * Deliberately "as of the day before this month starts," not "as of right
 * now": a masterlist can backfill an older month after a newer one has
 * already been imported, and comparing against today's live roster would
 * flag people who separated *after* the month being backfilled as if they
 * were missing from it.
 */
async function activeEmployeesAsOf(asOfDate: string): Promise<ActiveEmployee[]> {
  const rows = await db
    .select({ id: employees.id, eid: employees.eid, name: employees.name })
    .from(employeeAssignments)
    .innerJoin(employees, eq(employees.id, employeeAssignments.employeeId))
    .where(
      and(
        lte(employeeAssignments.effectiveFrom, asOfDate),
        or(isNull(employeeAssignments.effectiveTo), gte(employeeAssignments.effectiveTo, asOfDate)),
      ),
    );
  // The no-overlap exclusion constraint on employee_assignments guarantees
  // at most one interval covers any given date for a given person, so no
  // de-duplication is needed here.
  return rows;
}

export interface MasterlistDiff {
  /** Agent EIDs in the file that don't match any known employee. */
  unknownEids: string[];
  /**
   * Agents active as of the day before this month who are missing from the
   * file. A masterlist is a complete roster, not an incremental statement
   * like the weekly workbook — silence here means something, so these are
   * surfaced before commit rather than left alone the way an ordinary
   * weekly import would leave an unmentioned person.
   */
  missingEids: Array<{ eid: string; name: string }>;
  /** Rows whose Agent EID matched a known employee and will be written. */
  matchedCount: number;
}

/**
 * Compares the file against the database without writing anything — the
 * read half of the same check `commitMasterlist` repeats for itself before
 * actually writing, so a preview can never go stale between review and
 * commit the way trusting a cached preview result would.
 */
export async function diffMasterlist(rows: ParsedMasterlistRow[], monthStart: string): Promise<MasterlistDiff> {
  const { start } = resolveMasterlistMonth(monthStart);
  const fileEids = new Set(rows.map((r) => r.agentEid));

  const known = await db.select({ eid: employees.eid }).from(employees).where(inArray(employees.eid, [...fileEids]));
  const knownEids = new Set(known.map((e) => e.eid));
  const unknownEids = [...fileEids].filter((eid) => !knownEids.has(eid));

  const activeBefore = await activeEmployeesAsOf(shiftDay(start, -1));
  const missingEids = activeBefore.filter((e) => !fileEids.has(e.eid)).map((e) => ({ eid: e.eid, name: e.name }));

  return {
    unknownEids,
    missingEids,
    matchedCount: rows.filter((r) => knownEids.has(r.agentEid)).length,
  };
}

export interface MasterlistCommitPlan {
  /** Rows to insert into employee_assignments, replacing whatever exists there for these employees. */
  values: Array<typeof employeeAssignments.$inferInsert>;
  /** Employee ids the insert above covers — delete their old rows before inserting these. */
  employeeIdsToReplace: string[];
  /** Employee ids whose open assignment should be closed as of `closedBefore`, no new interval given. */
  employeeIdsToClose: string[];
  closedBefore: string;
  unknownEids: string[];
  agentsWritten: number;
  attritedClosed: Array<{ eid: string; name: string }>;
}

/**
 * The pure half of committing a masterlist: given what the file says and
 * what the database already holds, decides exactly what to write — no
 * database access of its own, so every awkward case (a re-upload of the
 * same month, an agent who separated then reappears, an unknown EID mixed
 * in with known ones) can be pinned down in a test rather than found in
 * production. `commitMasterlist` below does the actual reading and writing
 * around this.
 *
 * Reuses the exact interval-splicing logic the weekly workbook import uses
 * for the same table (`collapseWeeks`/`spliceAssignments` in
 * src/lib/org/assignments.ts) by representing the whole month as a single
 * `OrgWeek` per agent — those functions operate on arbitrary date ranges,
 * not literal 7-day weeks, so a month-long "week" splices in exactly the
 * same safe way: it replaces what's known about this month and leaves
 * every other month's history untouched.
 *
 * Attrition is handled separately and explicitly, not through the splice:
 * spliceAssignments treats an agent absent from `incoming` as unmentioned,
 * not as news — correct for the weekly workbook's incremental statements,
 * wrong for a masterlist's complete-roster ones. An agent who was active
 * (as of the day before this month) and is missing from this file has
 * their open assignment closed out as of that same day, and gets no new
 * interval — they simply have no coverage from this month on, same as
 * anyone who separates.
 */
export function planMasterlistCommit(
  rows: ParsedMasterlistRow[],
  monthStart: string,
  monthEnd: string,
  knownEmployees: Array<{ id: string; eid: string }>,
  existingAssignments: Array<{ employeeId: string } & Assignment>,
  activeBefore: ActiveEmployee[],
  importBatchId: string,
): MasterlistCommitPlan {
  const employeeIdByEid = new Map(knownEmployees.map((e) => [e.eid, e.id]));
  const fileEids = rows.map((r) => r.agentEid);
  const unknownEids = [...new Set(fileEids)].filter((eid) => !employeeIdByEid.has(eid));

  const matchedRows = rows.filter((r) => employeeIdByEid.has(r.agentEid));
  const employeeIdsToReplace = matchedRows.map((r) => employeeIdByEid.get(r.agentEid)!);

  const existingByEmployee = new Map<string, Assignment[]>();
  for (const row of existingAssignments) {
    existingByEmployee.set(row.employeeId, [...(existingByEmployee.get(row.employeeId) ?? []), row]);
  }

  const values: Array<typeof employeeAssignments.$inferInsert> = [];
  for (const row of matchedRows) {
    const employeeId = employeeIdByEid.get(row.agentEid)!;
    const week: OrgWeek = {
      weekStart: monthStart,
      weekEnd: monthEnd,
      supervisorEid: row.supervisorEid,
      supervisorName: row.supervisorName,
      managerName: row.managerName,
      site: row.site,
    };
    const incoming = collapseWeeks([week]);
    const existing = (existingByEmployee.get(employeeId) ?? []).sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    for (const a of spliceAssignments(existing, incoming, monthStart, monthEnd)) {
      values.push({
        employeeId,
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo,
        supervisorEid: a.supervisorEid,
        supervisorName: a.supervisorName,
        managerName: a.managerName,
        site: a.site,
        sourceImportId: importBatchId,
      });
    }
  }

  const fileEidSet = new Set(fileEids);
  const attrited = activeBefore.filter((e) => !fileEidSet.has(e.eid));
  const closedBefore = shiftDay(monthStart, -1);

  return {
    values,
    employeeIdsToReplace,
    employeeIdsToClose: attrited.map((e) => e.id),
    closedBefore,
    unknownEids,
    agentsWritten: matchedRows.length,
    attritedClosed: attrited.map((e) => ({ eid: e.eid, name: e.name })),
  };
}

export interface MasterlistCommitSummary {
  agentsWritten: number;
  unknownEids: string[];
  attritedClosed: Array<{ eid: string; name: string }>;
  /** Open action items closed because their owner left. */
  issuesClosed: number;
  /** People the roster lists again after an earlier month had closed them. */
  reactivated: number;
}

/**
 * Reads what's needed, plans the write with `planMasterlistCommit`, then
 * applies it in one transaction.
 *
 * Attrition here is the same event an EWS attrition tag records, and it
 * carries the same consequences: the person's employee row is marked
 * separated and their open action items are closed as of the week they
 * left (see closeIssuesOnSeparation), so someone who has gone does not
 * carry open work into the months after. The date-based rules do the rest —
 * they still count, and still show, for every day up to the closure and
 * for none after it. A person the roster lists again after an earlier
 * month closed them is marked active again; someone on leave is left on
 * leave, since that state is the supervisor's to clear.
 */
export async function commitMasterlist(
  rows: ParsedMasterlistRow[],
  monthStart: string,
  importBatchId: string,
  /** The administrator committing the roster, for the audit trail. */
  actorId: string | null = null,
): Promise<MasterlistCommitSummary> {
  const { start, end } = resolveMasterlistMonth(monthStart);

  const fileEids = rows.map((r) => r.agentEid);
  const knownEmployees = await db
    .select({ id: employees.id, eid: employees.eid })
    .from(employees)
    .where(inArray(employees.eid, fileEids));

  const candidateIds = knownEmployees.map((e) => e.id);
  const existingRows =
    candidateIds.length > 0
      ? await db.select().from(employeeAssignments).where(inArray(employeeAssignments.employeeId, candidateIds))
      : [];

  const activeBefore = await activeEmployeesAsOf(shiftDay(start, -1));

  const plan = planMasterlistCommit(rows, start, end, knownEmployees, existingRows, activeBefore, importBatchId);

  let issuesClosed = 0;
  let reactivated = 0;
  await db.transaction(async (tx) => {
    if (plan.employeeIdsToReplace.length > 0) {
      await tx.delete(employeeAssignments).where(inArray(employeeAssignments.employeeId, plan.employeeIdsToReplace));
      const CHUNK = 500;
      for (let i = 0; i < plan.values.length; i += CHUNK) {
        await tx.insert(employeeAssignments).values(plan.values.slice(i, i + CHUNK));
      }
      // Listed again after an earlier month closed them: back to active.
      const back = await tx
        .update(employees)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(inArray(employees.id, plan.employeeIdsToReplace), eq(employees.status, "separated")))
        .returning({ id: employees.id });
      reactivated = back.length;
      if (back.length > 0) {
        await tx.insert(auditLog).values(
          back.map((row) => ({
            actorId,
            action: "employee.status_changed",
            entityType: "employee",
            entityId: row.id,
            before: { status: "separated" },
            after: { status: "active", from: "masterlist", month: start, importBatchId },
          })),
        );
      }
    }
    if (plan.employeeIdsToClose.length > 0) {
      await tx
        .update(employeeAssignments)
        .set({ effectiveTo: plan.closedBefore })
        .where(
          and(isNull(employeeAssignments.effectiveTo), inArray(employeeAssignments.employeeId, plan.employeeIdsToClose)),
        );
      const gone = await tx
        .update(employees)
        .set({ status: "separated", updatedAt: new Date() })
        .where(and(inArray(employees.id, plan.employeeIdsToClose), ne(employees.status, "separated")))
        .returning({ id: employees.id, was: employees.status });
      if (gone.length > 0) {
        await tx.insert(auditLog).values(
          gone.map((row) => ({
            actorId,
            action: "employee.status_changed",
            entityType: "employee",
            entityId: row.id,
            before: { status: row.was },
            after: { status: "separated", from: "masterlist", month: start, closedBefore: plan.closedBefore, importBatchId },
          })),
        );
      }
      // Resolved as of the last week they were on the roster. For everyone
      // closed, not only the newly marked: someone an EWS tag had already
      // separated may still carry open work from before that closed it.
      issuesClosed = await closeIssuesOnSeparationFor(
        tx,
        plan.employeeIdsToClose,
        periodContaining("week", plan.closedBefore).start,
      );
    }
    // The roster of record is also the current structure for everyone it
    // lists: the employee rows (which the operational scope reads) follow it.
    await syncEmployeeSnapshots(tx, plan.employeeIdsToReplace);
  });

  return {
    agentsWritten: plan.agentsWritten,
    unknownEids: plan.unknownEids,
    attritedClosed: plan.attritedClosed,
    issuesClosed,
    reactivated,
  };
}
