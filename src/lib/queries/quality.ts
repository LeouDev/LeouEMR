import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { canAuditQuality } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees, ptoRequests, qaAuditResults, qaAudits, qaForms, users } from "@/lib/db/schema";
import type { AgentOption } from "@/lib/quality/agent-search";
import type { AnalysisWindow, AuditSummary, FailSummary } from "@/lib/quality/analysis";
import type { ExportAudit } from "@/lib/quality/csv";
import { qaFormFromRow, type QaForm } from "@/lib/quality/forms";
import type { MyAudit, MyResult } from "@/lib/quality/my-scores";
import type { FindingRow } from "@/lib/quality/scoring";
import { storedTimeMotionFromRow, type StoredTimeMotion } from "@/lib/quality/time-motion";
import { auditWeekOf, requiredFor, standingFor, type AgentWeekStanding, type AuditWeek } from "@/lib/quality/week";
import { separationDates } from "@/lib/queries/eligibility";
import { resolveScopedIds } from "@/lib/queries/performance";

/**
 * Reads for the Quality Audit pages. Every one starts with the role gate
 * and then the caller's employee scope — the same `employeeScope` rule the
 * rest of the app follows — so a supervisor sees their team, a manager
 * their span, an administrator everyone, and an agent nothing at all
 * without a query being made.
 */

/** The audit forms, in the order the workbook lists them. */
export async function getQaForms(): Promise<QaForm[]> {
  const rows = await db.select().from(qaForms).orderBy(asc(qaForms.sortOrder), asc(qaForms.key));
  return rows.map(qaFormFromRow);
}

async function scopeIds(user: CurrentUser): Promise<string[]> {
  if (!canAuditQuality(user)) return [];
  return resolveScopedIds(user);
}

export interface QaRosterRow {
  id: string;
  name: string;
  supervisorName: string | null;
  standing: AgentWeekStanding;
  required: number;
  completed: number;
}

export interface QaRoster {
  rows: QaRosterRow[];
  activeAgents: number;
  required: number;
  completed: number;
  /** Whole percent; 100 when nothing is required. */
  completionPct: number;
}

const EMPTY_ROSTER: QaRoster = { rows: [], activeAgents: 0, required: 0, completed: 0, completionPct: 100 };

/** Everyone in scope and what they owe this week, with what has been done. */
export async function getQaRoster(user: CurrentUser, week: AuditWeek): Promise<QaRoster> {
  const [roster] = await getQaRosters(user, [week]);
  return roster ?? EMPTY_ROSTER;
}

/**
 * The roster for several weeks at once — the month's four or five, for the
 * completion chart — read once: the people, their leave across the whole
 * span and their separations are the same for every week; only the audit
 * counts differ, and those come back per audit and are bucketed by week
 * here. Four weeks cost the same four reads as one.
 */
export async function getQaRosters(user: CurrentUser, weeks: readonly AuditWeek[]): Promise<QaRoster[]> {
  if (weeks.length === 0) return [];
  const ids = await scopeIds(user);
  if (ids.length === 0) return weeks.map(() => EMPTY_ROSTER);

  const spanStart = weeks.map((w) => w.start).sort()[0];
  const spanEnd = weeks.map((w) => w.end).sort().at(-1)!;

  const [people, leave, separated, audits] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, status: employees.status, supervisorName: employees.supervisorName })
      .from(employees)
      .where(inArray(employees.id, ids))
      .orderBy(asc(employees.name)),
    // Approved leave touching the span; whether it covers all seven days
    // of a week is decided per person and week in standingFor.
    db
      .select({ employeeId: ptoRequests.employeeId, start: ptoRequests.startDate, end: ptoRequests.endDate })
      .from(ptoRequests)
      .where(
        and(
          inArray(ptoRequests.employeeId, ids),
          eq(ptoRequests.status, "approved"),
          lte(ptoRequests.startDate, spanEnd),
          gte(ptoRequests.endDate, spanStart),
        ),
      ),
    separationDates(ids),
    // Only the team leader's own audits complete the requirement; a
    // support role's audit is on the record but does not count here.
    db
      .select({ agentId: qaAudits.agentId, auditDate: qaAudits.auditDate, n: count() })
      .from(qaAudits)
      .where(
        and(
          inArray(qaAudits.agentId, ids),
          eq(qaAudits.countsForRequirement, true),
          gte(qaAudits.auditDate, spanStart),
          lte(qaAudits.auditDate, spanEnd),
        ),
      )
      .groupBy(qaAudits.agentId, qaAudits.auditDate),
  ]);

  const leaveByAgent = new Map<string, Array<{ start: string; end: string }>>();
  for (const row of leave) {
    if (!row.employeeId) continue;
    leaveByAgent.set(row.employeeId, [...(leaveByAgent.get(row.employeeId) ?? []), { start: row.start, end: row.end }]);
  }
  // `${weekStart}|${agentId}` -> audits that week.
  const doneByWeekAgent = new Map<string, number>();
  for (const audit of audits) {
    const key = `${auditWeekOf(audit.auditDate).start}|${audit.agentId}`;
    doneByWeekAgent.set(key, (doneByWeekAgent.get(key) ?? 0) + audit.n);
  }

  return weeks.map((week) => {
    // Someone who left before the week is not on its roster at all — not
    // even as a "not required" row. On the calendar of a week they were
    // still here, they are listed and owe audits like anyone else.
    const rows: QaRosterRow[] = people
      .map((person) => {
        const standing = standingFor(
          { status: person.status, separatedOn: separated.get(person.id) ?? null, leave: leaveByAgent.get(person.id) ?? [] },
          week,
        );
        return {
          id: person.id,
          name: person.name,
          supervisorName: person.supervisorName,
          standing,
          required: requiredFor(standing),
          completed: doneByWeekAgent.get(`${week.start}|${person.id}`) ?? 0,
        };
      })
      .filter((row) => row.standing !== "separated");

    const active = rows.filter((r) => r.standing === "active");
    const required = active.reduce((sum, r) => sum + r.required, 0);
    const completed = active.reduce((sum, r) => sum + r.completed, 0);
    return {
      rows,
      activeAgents: active.length,
      required,
      completed,
      completionPct: required === 0 ? 100 : Math.min(100, Math.round((completed / required) * 100)),
    };
  });
}

/**
 * The agents an evaluator may pick: in scope and not gone before the week
 * being audited — the roster's own rule, so someone who left mid-week is
 * still auditable for that week, as the dashboard says they are.
 */
export async function getQaAgentOptions(
  user: CurrentUser,
  week: AuditWeek = auditWeekOf(new Date().toISOString().slice(0, 10)),
): Promise<AgentOption[]> {
  const ids = await scopeIds(user);
  if (ids.length === 0) return [];
  const [rows, separated] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        eid: employees.eid,
        supervisorName: employees.supervisorName,
        status: employees.status,
      })
      .from(employees)
      .where(inArray(employees.id, ids))
      .orderBy(asc(employees.name)),
    separationDates(ids),
  ]);
  return rows
    .filter((r) => standingFor({ status: r.status, separatedOn: separated.get(r.id) ?? null, leave: [] }, week) !== "separated")
    .map((r) => ({ id: r.id, name: r.name, eid: r.eid, supervisorName: r.supervisorName }));
}

export interface QaHistoryRow {
  id: string;
  agentId: string;
  agentName: string;
  formKey: string;
  formLabel: string;
  auditDate: string;
  /** The date of the call, case or fax; null on audits filed before it was asked for. */
  transactionDate: string | null;
  evaluatorName: string;
  scorePct: number;
  isCritical: boolean;
  remarks: string | null;
  headerValues: Record<string, string>;
  headerFields: Array<{ key: string; label: string }>;
  /** ISO timestamp once the agent has acknowledged the review. */
  acknowledgedAt: string | null;
  timeMotion: StoredTimeMotion | null;
  /** False for a support role's audit, which does not complete the weekly requirement. */
  countsForRequirement: boolean;
}

export const HISTORY_LIMIT = 500;

/** Past audits in scope, newest first. */
export async function getQaHistory(user: CurrentUser): Promise<QaHistoryRow[]> {
  const ids = await scopeIds(user);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: qaAudits.id,
      agentId: qaAudits.agentId,
      agentName: employees.name,
      formKey: qaAudits.formKey,
      formLabel: qaForms.label,
      headerFields: qaForms.headerFields,
      auditDate: qaAudits.auditDate,
      transactionDate: qaAudits.transactionDate,
      evaluatorName: users.name,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
      remarks: qaAudits.remarks,
      headerValues: qaAudits.headerValues,
      acknowledgedAt: qaAudits.acknowledgedAt,
      timeMotion: qaAudits.timeMotion,
      countsForRequirement: qaAudits.countsForRequirement,
    })
    .from(qaAudits)
    .innerJoin(employees, eq(employees.id, qaAudits.agentId))
    .innerJoin(qaForms, eq(qaForms.key, qaAudits.formKey))
    .innerJoin(users, eq(users.id, qaAudits.evaluatorId))
    .where(inArray(qaAudits.agentId, ids))
    .orderBy(desc(qaAudits.auditDate), desc(qaAudits.createdAt))
    .limit(HISTORY_LIMIT);
  return rows.map((row) => ({
    ...row,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    timeMotion: storedTimeMotionFromRow(row.timeMotion),
    scorePct: Number(row.scorePct),
    headerValues: (row.headerValues ?? {}) as Record<string, string>,
    headerFields: ((row.headerFields ?? []) as Array<{ key: string; label: string }>).map((f) => ({ key: f.key, label: f.label })),
  }));
}

/** One audit's raw data, or every audit's, in scope — for the CSV exports. */
export async function getQaExport(user: CurrentUser, auditId: string | null): Promise<ExportAudit[]> {
  const ids = await scopeIds(user);
  if (ids.length === 0) return [];
  const audits = await db
    .select({
      id: qaAudits.id,
      agentName: employees.name,
      agentEid: employees.eid,
      form: qaForms,
      auditDate: qaAudits.auditDate,
      transactionDate: qaAudits.transactionDate,
      evaluatorName: users.name,
      headerValues: qaAudits.headerValues,
      remarks: qaAudits.remarks,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
      timeMotion: qaAudits.timeMotion,
    })
    .from(qaAudits)
    .innerJoin(employees, eq(employees.id, qaAudits.agentId))
    .innerJoin(qaForms, eq(qaForms.key, qaAudits.formKey))
    .innerJoin(users, eq(users.id, qaAudits.evaluatorId))
    .where(and(inArray(qaAudits.agentId, ids), auditId ? eq(qaAudits.id, auditId) : undefined))
    .orderBy(asc(qaAudits.auditDate), asc(qaAudits.createdAt));
  if (audits.length === 0) return [];

  const results = await db
    .select({
      auditId: qaAuditResults.auditId,
      position: qaAuditResults.position,
      category: qaAuditResults.category,
      attribute: qaAuditResults.attribute,
      isCompliance: qaAuditResults.isCompliance,
      result: qaAuditResults.result,
    })
    .from(qaAuditResults)
    .where(inArray(qaAuditResults.auditId, audits.map((a) => a.id)))
    .orderBy(asc(qaAuditResults.auditId), asc(qaAuditResults.position));
  const findingsByAudit = new Map<string, FindingRow[]>();
  for (const r of results) {
    findingsByAudit.set(r.auditId, [
      ...(findingsByAudit.get(r.auditId) ?? []),
      { position: r.position, category: r.category, attribute: r.attribute, isCompliance: r.isCompliance, result: r.result },
    ]);
  }

  return audits.map((a) => ({
    agentName: a.agentName,
    agentEid: a.agentEid,
    form: qaFormFromRow(a.form),
    auditDate: a.auditDate,
    transactionDate: a.transactionDate,
    evaluatorName: a.evaluatorName,
    headerValues: (a.headerValues ?? {}) as Record<string, string>,
    remarks: a.remarks,
    scorePct: Number(a.scorePct),
    isCritical: a.isCritical,
    findings: findingsByAudit.get(a.id) ?? [],
    timeMotion: storedTimeMotionFromRow(a.timeMotion),
  }));
}

/** The audits and failed findings the analysis page summarises: the window and the one before it. */
export async function getQaAnalysisInput(
  user: CurrentUser,
  window: AnalysisWindow,
): Promise<{ audits: AuditSummary[]; fails: FailSummary[] }> {
  const ids = await scopeIds(user);
  if (ids.length === 0) return { audits: [], fails: [] };
  const audits = await db
    .select({
      id: qaAudits.id,
      agentName: employees.name,
      supervisorName: employees.supervisorName,
      managerName: employees.managerName,
      auditDate: qaAudits.auditDate,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
      formKey: qaAudits.formKey,
      formLabel: qaForms.label,
    })
    .from(qaAudits)
    .innerJoin(employees, eq(employees.id, qaAudits.agentId))
    .innerJoin(qaForms, eq(qaForms.key, qaAudits.formKey))
    .where(and(inArray(qaAudits.agentId, ids), gte(qaAudits.auditDate, window.priorStart), lte(qaAudits.auditDate, window.end)));
  if (audits.length === 0) return { audits: [], fails: [] };

  const fails = await db
    .select({
      auditId: qaAuditResults.auditId,
      category: qaAuditResults.category,
      attribute: qaAuditResults.attribute,
      isCompliance: qaAuditResults.isCompliance,
    })
    .from(qaAuditResults)
    .where(and(inArray(qaAuditResults.auditId, audits.map((a) => a.id)), eq(qaAuditResults.result, "fail")));

  return { audits: audits.map((a) => ({ ...a, scorePct: Number(a.scorePct) })), fails };
}

/**
 * An agent's own audits with every scored attribute — for My Quality
 * Scores. Only an agent linked to an employee row gets anything; the
 * audits are keyed on that row, never on an id the page supplies.
 */
export async function getMyQualityScores(
  user: CurrentUser,
): Promise<{ employee: { id: string; name: string }; audits: MyAudit[] } | null> {
  if (user.role !== "agent" || !user.employeeEid) return null;
  const [me] = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(eq(employees.eid, user.employeeEid))
    .limit(1);
  if (!me) return null;

  const rows = await db
    .select({
      id: qaAudits.id,
      formLabel: qaForms.label,
      auditDate: qaAudits.auditDate,
      transactionDate: qaAudits.transactionDate,
      evaluatorName: users.name,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
      remarks: qaAudits.remarks,
      acknowledgedAt: qaAudits.acknowledgedAt,
    })
    .from(qaAudits)
    .innerJoin(qaForms, eq(qaForms.key, qaAudits.formKey))
    .innerJoin(users, eq(users.id, qaAudits.evaluatorId))
    .where(eq(qaAudits.agentId, me.id))
    .orderBy(asc(qaAudits.auditDate), asc(qaAudits.createdAt));
  if (rows.length === 0) return { employee: me, audits: [] };

  const results = await db
    .select({
      auditId: qaAuditResults.auditId,
      position: qaAuditResults.position,
      category: qaAuditResults.category,
      attribute: qaAuditResults.attribute,
      isCompliance: qaAuditResults.isCompliance,
      result: qaAuditResults.result,
    })
    .from(qaAuditResults)
    .where(inArray(qaAuditResults.auditId, rows.map((r) => r.id)))
    .orderBy(asc(qaAuditResults.auditId), asc(qaAuditResults.position));
  const byAudit = new Map<string, MyResult[]>();
  for (const r of results) {
    byAudit.set(r.auditId, [
      ...(byAudit.get(r.auditId) ?? []),
      { position: r.position, category: r.category, attribute: r.attribute, isCompliance: r.isCompliance, result: r.result },
    ]);
  }

  return {
    employee: me,
    audits: rows.map((row) => ({
      id: row.id,
      formLabel: row.formLabel,
      auditDate: row.auditDate,
      transactionDate: row.transactionDate,
      evaluatorName: row.evaluatorName,
      scorePct: Number(row.scorePct),
      isCritical: row.isCritical,
      remarks: row.remarks,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      results: byAudit.get(row.id) ?? [],
    })),
  };
}
