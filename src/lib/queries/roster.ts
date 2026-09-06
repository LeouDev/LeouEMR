import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { employeeScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  employees,
  ewsAssessments,
  kpiDefinitions,
  performanceIssues,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { OPENS_ACTION_ITEMS, OPEN_STATUSES } from "./performance";

export interface RosterFilters {
  search?: string;
  supervisor?: string;
  site?: string;
  risk?: string;
  /** "failing" | "attention" | "clear" */
  standing?: string;
}

export interface RosterRow {
  id: string;
  eid: string;
  name: string;
  supervisorName: string | null;
  managerName: string | null;
  site: string | null;
  failingKpis: number;
  openIssues: number;
  ewsRisk: string | null;
  ewsScore: number | null;
}

/**
 * The searchable roster.
 *
 * Scope is applied first and independently of the filters, so a search term
 * can never widen what a user can see — it only narrows within their own
 * scope.
 */
export interface RosterPage {
  rows: RosterRow[];
  /** How many rows match scope and filters in total, before `limit` cuts the page. */
  total: number;
}

export async function getRoster(
  user: CurrentUser,
  week: string | null,
  filters: RosterFilters,
  limit = 500,
): Promise<RosterPage> {
  const scope = employeeScope(user);
  if (scope === null) return { rows: [], total: 0 };

  const search = filters.search?.trim();
  const conditions = [
    scope === "all" ? undefined : scope,
    search
      ? or(
          ilike(employees.name, `%${search}%`),
          ilike(employees.eid, `%${search}%`),
          ilike(employees.supervisorName, `%${search}%`),
          ilike(employees.managerName, `%${search}%`),
        )
      : undefined,
    filters.supervisor ? eq(employees.supervisorName, filters.supervisor) : undefined,
    filters.site ? eq(employees.site, filters.site) : undefined,
  ].filter(Boolean);

  // The count shares the same conditions as the page of rows, minus the
  // limit, so the UI can say when a browse (no search) has been cut off
  // rather than silently rendering a partial roster as if it were complete.
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [matched, [{ total }]] = await Promise.all([
    db
      .select({
        id: employees.id,
        eid: employees.eid,
        name: employees.name,
        supervisorName: employees.supervisorName,
        managerName: employees.managerName,
        site: employees.site,
      })
      .from(employees)
      .where(whereClause)
      .orderBy(employees.name)
      .limit(limit),
    db.select({ total: count() }).from(employees).where(whereClause),
  ]);

  if (matched.length === 0) return { rows: [], total };
  const ids = matched.map((row) => row.id);

  // Three independent reads, all keyed only on `ids`.
  const [failing, open, ews] = await Promise.all([
    week
      ? db
          .select({ employeeId: weeklyMetricResults.employeeId, n: count() })
          .from(weeklyMetricResults)
          .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
          .where(
            and(
              inArray(weeklyMetricResults.employeeId, ids),
              eq(weeklyMetricResults.weekStart, week),
              eq(weeklyMetricResults.status, "fail"),
              eq(kpiDefinitions.generatesActionItems, true),
            ),
          )
          .groupBy(weeklyMetricResults.employeeId)
      : Promise.resolve([]),
    db
      .select({ employeeId: performanceIssues.employeeId, n: count() })
      .from(performanceIssues)
      .where(
        and(
          inArray(performanceIssues.employeeId, ids),
          inArray(performanceIssues.status, [...OPEN_STATUSES]),
          OPENS_ACTION_ITEMS,
        ),
      )
      .groupBy(performanceIssues.employeeId),
    week
      ? db
          .select({
            employeeId: ewsAssessments.employeeId,
            riskLevel: ewsAssessments.riskLevel,
            score: ewsAssessments.score,
          })
          .from(ewsAssessments)
          .where(and(inArray(ewsAssessments.employeeId, ids), eq(ewsAssessments.week, week)))
      : Promise.resolve([]),
  ]);

  const failingBy = new Map(failing.map((r) => [r.employeeId, r.n]));
  const openBy = new Map(open.map((r) => [r.employeeId, r.n]));
  const ewsBy = new Map(ews.map((r) => [r.employeeId, r]));

  const rows: RosterRow[] = matched.map((row) => ({
    ...row,
    failingKpis: failingBy.get(row.id) ?? 0,
    openIssues: openBy.get(row.id) ?? 0,
    ewsRisk: ewsBy.get(row.id)?.riskLevel ?? null,
    ewsScore: ewsBy.get(row.id)?.score ?? null,
  }));

  const filtered = rows.filter((row) => {
    if (filters.risk && row.ewsRisk !== filters.risk) return false;
    if (filters.standing === "failing" && row.failingKpis === 0) return false;
    if (filters.standing === "attention" && row.openIssues === 0) return false;
    if (filters.standing === "clear" && (row.failingKpis > 0 || row.openIssues > 0)) return false;
    return true;
  });

  // The risk/standing filters apply in memory after the page is fetched, so
  // `total` (a plain count of scope + search/supervisor/site) can overstate
  // how many rows match once they run. It still correctly answers the
  // question that matters: was the *page itself* cut off by `limit`.
  return { rows: filtered, total };
}

/** Distinct supervisors and sites within the caller's scope, for the filter menus. */
export async function getRosterFacets(user: CurrentUser) {
  const scope = employeeScope(user);
  if (scope === null) return { supervisors: [], sites: [] };

  const rows = await db
    .selectDistinct({ supervisorName: employees.supervisorName, site: employees.site })
    .from(employees)
    .where(scope === "all" ? undefined : scope);

  return {
    supervisors: [...new Set(rows.map((r) => r.supervisorName).filter(Boolean))].sort() as string[],
    sites: [...new Set(rows.map((r) => r.site).filter(Boolean))].sort() as string[],
  };
}

export interface SupervisorRollup {
  supervisorName: string;
  teamSize: number;
  openIssues: number;
  awaitingAcknowledgement: number;
  failingThisWeek: number;
}

/**
 * Per-supervisor rollup, so a manager can see which supervisors carry the
 * most open work (spec section 13).
 */
export async function getSupervisorRollup(
  user: CurrentUser,
  week: string | null,
): Promise<SupervisorRollup[]> {
  const scope = employeeScope(user);
  if (scope === null) return [];

  const team = await db
    .select({ supervisorName: employees.supervisorName, n: count() })
    .from(employees)
    .where(scope === "all" ? undefined : scope)
    .groupBy(employees.supervisorName);

  const issues = await db
    .select({
      supervisorName: employees.supervisorName,
      status: performanceIssues.status,
      n: count(),
    })
    .from(performanceIssues)
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .where(
      and(
        scope === "all" ? undefined : scope,
        inArray(performanceIssues.status, [...OPEN_STATUSES]),
        OPENS_ACTION_ITEMS,
      ),
    )
    .groupBy(employees.supervisorName, performanceIssues.status);

  const failing = week
    ? await db
        .select({
          supervisorName: employees.supervisorName,
          n: sql<number>`count(distinct ${weeklyMetricResults.employeeId})::int`,
        })
        .from(weeklyMetricResults)
        .innerJoin(employees, eq(employees.id, weeklyMetricResults.employeeId))
        .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
        .where(
          and(
            scope === "all" ? undefined : scope,
            eq(weeklyMetricResults.weekStart, week),
            eq(weeklyMetricResults.status, "fail"),
            eq(kpiDefinitions.generatesActionItems, true),
          ),
        )
        .groupBy(employees.supervisorName)
    : [];

  const openBy = new Map<string, number>();
  const awaitingBy = new Map<string, number>();
  for (const row of issues) {
    const key = row.supervisorName ?? "Unassigned";
    openBy.set(key, (openBy.get(key) ?? 0) + row.n);
    if (row.status === "AWAITING_AGENT_ACKNOWLEDGEMENT") {
      awaitingBy.set(key, (awaitingBy.get(key) ?? 0) + row.n);
    }
  }
  const failingBy = new Map(failing.map((r) => [r.supervisorName ?? "Unassigned", r.n]));

  return team
    .map((row) => {
      const key = row.supervisorName ?? "Unassigned";
      return {
        supervisorName: key,
        teamSize: row.n,
        openIssues: openBy.get(key) ?? 0,
        awaitingAcknowledgement: awaitingBy.get(key) ?? 0,
        failingThisWeek: failingBy.get(key) ?? 0,
      };
    })
    .sort((a, b) => b.openIssues - a.openIssues);
}

/** Action items past their due date and still unresolved. */
export async function getOverdueCount(user: CurrentUser, today: string): Promise<number> {
  const scope = employeeScope(user);
  if (scope === null) return 0;

  const [row] = await db
    .select({ n: count() })
    .from(performanceIssues)
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .where(
      and(
        scope === "all" ? undefined : scope,
        inArray(performanceIssues.status, [...OPEN_STATUSES]),
        OPENS_ACTION_ITEMS,
        sql`exists (
          select 1 from action_items ai
          where ai.performance_issue_id = ${performanceIssues.id}
            and ai.due_date is not null and ai.due_date < ${today}
        )`,
      ),
    );

  return row?.n ?? 0;
}

export { desc };
