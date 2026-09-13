import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { canAuditQuality } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees, ptoRequests, qaAuditResults, qaAudits, qaForms, users } from "@/lib/db/schema";
import type { AnalysisWindow, AuditSummary, FailSummary } from "@/lib/quality/analysis";
import type { ExportAudit } from "@/lib/quality/csv";
import { qaFormFromRow, type QaForm } from "@/lib/quality/forms";
import type { FindingRow } from "@/lib/quality/scoring";
import { requiredFor, standingFor, type AgentWeekStanding, type AuditWeek } from "@/lib/quality/week";
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
  const ids = await scopeIds(user);
  if (ids.length === 0) return EMPTY_ROSTER;

  const [people, leave, separated, counts] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, status: employees.status, supervisorName: employees.supervisorName })
      .from(employees)
      .where(inArray(employees.id, ids))
      .orderBy(asc(employees.name)),
    // Approved leave touching the week; whether it covers all seven days
    // is decided per person in standingFor.
    db
      .select({ employeeId: ptoRequests.employeeId, start: ptoRequests.startDate, end: ptoRequests.endDate })
      .from(ptoRequests)
      .where(
        and(
          inArray(ptoRequests.employeeId, ids),
          eq(ptoRequests.status, "approved"),
          lte(ptoRequests.startDate, week.end),
          gte(ptoRequests.endDate, week.start),
        ),
      ),
    separationDates(ids),
    db
      .select({ agentId: qaAudits.agentId, n: count() })
      .from(qaAudits)
      .where(and(inArray(qaAudits.agentId, ids), gte(qaAudits.auditDate, week.start), lte(qaAudits.auditDate, week.end)))
      .groupBy(qaAudits.agentId),
  ]);

  const leaveByAgent = new Map<string, Array<{ start: string; end: string }>>();
  for (const row of leave) {
    if (!row.employeeId) continue;
    leaveByAgent.set(row.employeeId, [...(leaveByAgent.get(row.employeeId) ?? []), { start: row.start, end: row.end }]);
  }
  const doneByAgent = new Map(counts.map((c) => [c.agentId, c.n]));

  const rows: QaRosterRow[] = people.map((person) => {
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
      completed: doneByAgent.get(person.id) ?? 0,
    };
  });

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
}

/** The agents an evaluator may pick: in scope and still on the roster. */
export async function getQaAgentOptions(user: CurrentUser): Promise<Array<{ id: string; name: string }>> {
  const ids = await scopeIds(user);
  if (ids.length === 0) return [];
  const [rows, separated] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, status: employees.status })
      .from(employees)
      .where(inArray(employees.id, ids))
      .orderBy(asc(employees.name)),
    separationDates(ids),
  ]);
  return rows.filter((r) => r.status !== "separated" && !separated.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
}

export interface QaHistoryRow {
  id: string;
  agentId: string;
  agentName: string;
  formKey: string;
  formLabel: string;
  auditDate: string;
  evaluatorName: string;
  scorePct: number;
  isCritical: boolean;
  remarks: string | null;
  headerValues: Record<string, string>;
  headerFields: Array<{ key: string; label: string }>;
}

const HISTORY_LIMIT = 500;

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
      evaluatorName: users.name,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
      remarks: qaAudits.remarks,
      headerValues: qaAudits.headerValues,
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
      evaluatorName: users.name,
      headerValues: qaAudits.headerValues,
      remarks: qaAudits.remarks,
      scorePct: qaAudits.scorePct,
      isCritical: qaAudits.isCritical,
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
    evaluatorName: a.evaluatorName,
    headerValues: (a.headerValues ?? {}) as Record<string, string>,
    remarks: a.remarks,
    scorePct: Number(a.scorePct),
    isCritical: a.isCritical,
    findings: findingsByAudit.get(a.id) ?? [],
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
    })
    .from(qaAudits)
    .innerJoin(employees, eq(employees.id, qaAudits.agentId))
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
