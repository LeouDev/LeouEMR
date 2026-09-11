import { and, asc, count, desc, eq, ilike, inArray, isNotNull, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { CACHE_TAG, cachedRead } from "@/lib/cache";
import { db } from "@/lib/db/client";
import {
  actionItems,
  acknowledgements,
  actionPlans,
  employees,
  ewsAssessments,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  rcaNotes,
  rootCauseCategories,
  timeMotionStudies,
  users,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { canViewRecords, employeeScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";

/** Statuses still requiring attention (not resolved). */
/**
 * Restricts a query over `performance_issues` to KPIs that still generate
 * action items.
 *
 * Written as an EXISTS rather than a join so it can be dropped into any
 * existing `where` without reshaping the query. It matters because the flag
 * can be turned off after items already exist — MBO is assessed monthly, so
 * its weekly items should stop counting everywhere at once rather than being
 * filtered out at each call site by hand, or deleted irreversibly.
 */
export const OPENS_ACTION_ITEMS = sql`exists (
  select 1 from kpi_definitions k
  where k.id = ${performanceIssues.kpiId} and k.generates_action_items
)`;

export const OPEN_STATUSES = [
  "OPEN",
  "AWAITING_AGENT_ACKNOWLEDGEMENT",
  "ACKNOWLEDGED",
  "MONITORING",
  "SUSTAINED",
  "REOPENED",
] as const;

/**
 * Weeks of an unbroken pass, ending at the latest week — or with no data
 * recorded at all — before a row drops off the "Development item" table.
 * Unrelated to the 4-week counter that actually closes an open action item
 * (SUSTAINED_WEEKS in development.ts): that one changes the item's real
 * status; this one only governs whether its row is worth showing right now.
 * The KPI grid itself is never filtered by this — it stays the full history
 * regardless.
 */
export const SUSTAINED_PASS_WEEKS = 8;

/**
 * The development plan's KPI grid, in the order the business reads it: the
 * headline scorecard, whether or not a KPI opens items. The per-skill and
 * per-KPI work items are the development-item table beneath it.
 */
export const PLAN_KPI_CODES = [
  "PRODUCTION_RATE",
  "QUALITY",
  "NPS",
  "CRITICAL_ERRORS",
  "MBO",
  "ATTENDANCE",
] as const;

/** The newest reporting week in the ledger. Changes only on import. */
export const getLatestWeek = cachedRead("latest-week", [CACHE_TAG.imports], async (): Promise<string | null> => {
  const [row] = await db.select({ week: max(weeklyMetricResults.weekStart) }).from(weeklyMetricResults);
  return row?.week ?? null;
});

/**
 * The newest reporting week this user actually has results for.
 *
 * The dashboard used to open on the newest week that exists anywhere, which
 * is only the same thing while every team is imported together. Sixteen rows
 * inserted for one agent four weeks past everyone else's data was enough to
 * land every manager, supervisor and agent on an empty dashboard by default.
 *
 * Falls back to the global latest so an account with no results of its own
 * still opens somewhere real rather than on nothing at all.
 */
export async function getLatestWeekInScope(user: CurrentUser): Promise<string | null> {
  const scope = employeeScope(user);
  if (scope === null) return null;

  const [row] = await db
    .select({ week: max(weeklyMetricResults.weekStart) })
    .from(weeklyMetricResults)
    .innerJoin(employees, eq(employees.id, weeklyMetricResults.employeeId))
    .where(scope === "all" ? undefined : scope);
  return row?.week ?? null;
}

/** Employee ids the user may see. Returns null when the user may see none. */
async function scopedEmployeeIds(user: CurrentUser): Promise<string[] | "all" | null> {
  const scope = employeeScope(user);
  if (scope === null) return null;
  if (scope === "all") return "all";

  const rows = await db.select({ id: employees.id }).from(employees).where(scope);
  return rows.map((r) => r.id);
}

export interface TeamSummary {
  totalEmployees: number;
  passing: number;
  atRisk: number;
  failing: number;
  openIssues: number;
  awaitingAcknowledgement: number;
  monitoring: number;
  sustained: number;
  completed: number;
}

export async function getTeamSummary(user: CurrentUser, week: string | null): Promise<TeamSummary> {
  const empty: TeamSummary = {
    totalEmployees: 0,
    passing: 0,
    atRisk: 0,
    failing: 0,
    openIssues: 0,
    awaitingAcknowledgement: 0,
    monitoring: 0,
    sustained: 0,
    completed: 0,
  };

  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return empty;

  const employeeFilter = ids === "all" ? undefined : inArray(weeklyMetricResults.employeeId, ids);
  const issueFilter = ids === "all" ? undefined : inArray(performanceIssues.employeeId, ids);

  const [totals] = await db
    .select({ n: count() })
    .from(employees)
    .where(ids === "all" ? undefined : inArray(employees.id, ids));

  const statusRows = week
    ? await db
        .select({
          employeeId: weeklyMetricResults.employeeId,
          status: weeklyMetricResults.status,
          n: count(),
        })
        .from(weeklyMetricResults)
        .where(and(eq(weeklyMetricResults.weekStart, week), employeeFilter))
        .groupBy(weeklyMetricResults.employeeId, weeklyMetricResults.status)
    : [];

  const byEmployee = new Map<string, { fail: number; warning: number }>();
  for (const row of statusRows) {
    const entry = byEmployee.get(row.employeeId) ?? { fail: 0, warning: 0 };
    if (row.status === "fail") entry.fail += row.n;
    if (row.status === "warning") entry.warning += row.n;
    byEmployee.set(row.employeeId, entry);
  }

  let passing = 0;
  let atRisk = 0;
  let failing = 0;
  for (const entry of byEmployee.values()) {
    if (entry.fail > 0) failing += 1;
    else if (entry.warning > 0) atRisk += 1;
    else passing += 1;
  }

  const issueStatusRows = await db
    .select({ status: performanceIssues.status, n: count() })
    .from(performanceIssues)
    .where(issueFilter ? and(issueFilter, OPENS_ACTION_ITEMS) : OPENS_ACTION_ITEMS)
    .groupBy(performanceIssues.status);

  const byStatus = new Map(issueStatusRows.map((r) => [r.status, r.n]));

  return {
    totalEmployees: totals?.n ?? 0,
    passing,
    atRisk,
    failing,
    openIssues: OPEN_STATUSES.reduce((sum, s) => sum + (byStatus.get(s) ?? 0), 0),
    awaitingAcknowledgement: byStatus.get("AWAITING_AGENT_ACKNOWLEDGEMENT") ?? 0,
    monitoring: byStatus.get("MONITORING") ?? 0,
    sustained: byStatus.get("SUSTAINED") ?? 0,
    completed: byStatus.get("COMPLETED") ?? 0,
  };
}

export interface AttentionRow {
  employeeId: string;
  employeeName: string;
  employeeEid: string;
  kpiCode: string;
  kpiName: string;
  actualValue: number;
  targetValue: number | null;
  status: "pass" | "warning" | "fail";
  issueCode: string | null;
  actionItemCode: string | null;
  issueStatus: string | null;
  consecutivePassingWeeks: number | null;
  hasRca: boolean;
  /** Rows behind the aggregate — a low count means a thin, easily misread week. */
  sampleSize: number | null;
}

/** Failing metrics for the week, joined to their action item state. */
export async function getAttentionRows(
  user: CurrentUser,
  week: string | null,
  limit = 100,
): Promise<AttentionRow[]> {
  if (!week) return [];
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return [];

  const rows = await db
    .select({
      employeeId: employees.id,
      employeeName: employees.name,
      employeeEid: employees.eid,
      kpiCode: kpiDefinitions.code,
      kpiName: kpiDefinitions.name,
      actualValue: weeklyMetricResults.actualValue,
      targetValue: weeklyMetricResults.targetValue,
      status: weeklyMetricResults.status,
      sampleSize: weeklyMetricResults.sampleSize,
      issueCode: performanceIssues.code,
      issueStatus: performanceIssues.status,
      consecutivePassingWeeks: performanceIssues.consecutivePassingWeeks,
      actionItemCode: actionItems.code,
      rcaId: rcaEntries.id,
    })
    .from(weeklyMetricResults)
    .innerJoin(employees, eq(employees.id, weeklyMetricResults.employeeId))
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .leftJoin(
      performanceIssues,
      and(
        eq(performanceIssues.employeeId, weeklyMetricResults.employeeId),
        eq(performanceIssues.kpiId, weeklyMetricResults.kpiId),
        inArray(performanceIssues.status, [...OPEN_STATUSES]),
      ),
    )
    .leftJoin(actionItems, eq(actionItems.performanceIssueId, performanceIssues.id))
    .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
    .where(
      and(
        eq(weeklyMetricResults.weekStart, week),
        eq(weeklyMetricResults.status, "fail"),
        ids === "all" ? undefined : inArray(weeklyMetricResults.employeeId, ids),
      ),
    )
    .orderBy(employees.name)
    .limit(limit);

  return rows.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeEid: row.employeeEid,
    kpiCode: row.kpiCode,
    kpiName: row.kpiName,
    actualValue: row.actualValue,
    targetValue: row.targetValue,
    status: row.status,
    issueCode: row.issueCode,
    actionItemCode: row.actionItemCode,
    issueStatus: row.issueStatus,
    consecutivePassingWeeks: row.consecutivePassingWeeks,
    hasRca: row.rcaId !== null,
    sampleSize: row.sampleSize,
  }));
}

export interface ActionItemListRow {
  actionItemId: string;
  actionItemCode: string;
  issueCode: string;
  status: string;
  consecutivePassingWeeks: number;
  openedWeek: string;
  employeeId: string;
  employeeName: string;
  kpiName: string;
  kpiCode: string;
  hasRca: boolean;
  hasActionPlan: boolean;
}

/** Statuses an item sits in before anyone has written an RCA/action plan — see submitRcaAndPlan in the engine. */
export const UNSTARTED_STATUSES = ["OPEN", "REOPENED"] as const;

type IssueStatus = (typeof performanceIssues.$inferSelect)["status"];

interface ActionItemFilter {
  openOnly?: boolean;
  /** Narrows to exactly these statuses; takes precedence over `openOnly`. */
  statuses?: readonly IssueStatus[];
  employeeId?: string;
}

/** The one WHERE clause behind every action-item list and count, so they can never disagree. */
function actionItemWhere(ids: string[] | "all", options: ActionItemFilter) {
  return and(
    ids === "all" ? undefined : inArray(performanceIssues.employeeId, ids),
    options.statuses
      ? inArray(performanceIssues.status, [...options.statuses])
      : options.openOnly
        ? inArray(performanceIssues.status, [...OPEN_STATUSES])
        : undefined,
    options.employeeId ? eq(performanceIssues.employeeId, options.employeeId) : undefined,
    OPENS_ACTION_ITEMS,
  );
}

export async function getActionItems(
  user: CurrentUser,
  options: ActionItemFilter & { limit?: number; oldestFirst?: boolean } = {},
): Promise<ActionItemListRow[]> {
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return [];
  return listActionItems(ids, options);
}

/**
 * Items nobody has started on yet — no RCA or plan — as a true count plus
 * the few oldest, for a "needs your attention" panel.
 *
 * The count is its own query rather than the length of a capped list: the
 * Employees page used to fetch up to 1000 fully-joined rows to show five
 * and a number, and an admin with more open work than the cap was shown
 * the cap itself as if it were the count.
 */
export async function getUnstartedActionItems(
  user: CurrentUser,
  limit: number,
): Promise<{ total: number; items: ActionItemListRow[] }> {
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return { total: 0, items: [] };

  const filter = { statuses: UNSTARTED_STATUSES };
  const [[counted], items] = await Promise.all([
    db
      .select({ total: count() })
      .from(actionItems)
      .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
      .where(actionItemWhere(ids, filter)),
    // Oldest first: the one that has been waiting longest for a response.
    listActionItems(ids, { ...filter, limit, oldestFirst: true }),
  ]);
  return { total: counted?.total ?? 0, items };
}

async function listActionItems(
  ids: string[] | "all",
  options: ActionItemFilter & { limit?: number; oldestFirst?: boolean },
): Promise<ActionItemListRow[]> {
  const rows = await db
    .select({
      actionItemId: actionItems.id,
      actionItemCode: actionItems.code,
      issueCode: performanceIssues.code,
      status: performanceIssues.status,
      consecutivePassingWeeks: performanceIssues.consecutivePassingWeeks,
      openedWeek: performanceIssues.openedWeek,
      employeeId: employees.id,
      employeeName: employees.name,
      kpiName: kpiDefinitions.name,
      kpiCode: kpiDefinitions.code,
      rcaId: rcaEntries.id,
      planId: actionPlans.id,
    })
    .from(actionItems)
    .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
    .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
    .leftJoin(actionPlans, eq(actionPlans.actionItemId, actionItems.id))
    .where(actionItemWhere(ids, options))
    .orderBy(
      options.oldestFirst ? asc(performanceIssues.openedWeek) : desc(performanceIssues.openedWeek),
      employees.name,
    )
    .limit(options.limit ?? 200);

  return rows.map((row) => ({
    actionItemId: row.actionItemId,
    actionItemCode: row.actionItemCode,
    issueCode: row.issueCode,
    status: row.status,
    consecutivePassingWeeks: row.consecutivePassingWeeks,
    openedWeek: row.openedWeek,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    kpiName: row.kpiName,
    kpiCode: row.kpiCode,
    hasRca: row.rcaId !== null,
    hasActionPlan: row.planId !== null,
  }));
}

/** Full detail for one action item, scoped so a user cannot read another team's item by id. */
export async function getActionItemDetail(user: CurrentUser, actionItemId: string) {
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return null;

  const [row] = await db
    .select({
      actionItem: actionItems,
      issue: performanceIssues,
      employee: employees,
      kpi: kpiDefinitions,
      rca: rcaEntries,
      plan: actionPlans,
    })
    .from(actionItems)
    .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
    .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
    .leftJoin(actionPlans, eq(actionPlans.actionItemId, actionItems.id))
    .where(
      and(
        eq(actionItems.id, actionItemId),
        ids === "all" ? undefined : inArray(performanceIssues.employeeId, ids),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Five independent reads once `row` is known — issued together rather than
  // as five sequential round trips.
  const [history, acks, notes, metrics, timeMotion] = await Promise.all([
    db
      .select()
      .from(weeklyIssueHistory)
      .where(eq(weeklyIssueHistory.performanceIssueId, row.issue.id))
      .orderBy(weeklyIssueHistory.week),
    db
      .select()
      .from(acknowledgements)
      .where(eq(acknowledgements.actionItemId, actionItemId))
      .orderBy(desc(acknowledgements.acknowledgedAt)),
    db
      .select({
        id: rcaNotes.id,
        week: rcaNotes.week,
        note: rcaNotes.note,
        createdAt: rcaNotes.createdAt,
        authorName: users.name,
      })
      .from(rcaNotes)
      .leftJoin(users, eq(users.id, rcaNotes.createdBy))
      .where(eq(rcaNotes.actionItemId, actionItemId))
      .orderBy(desc(rcaNotes.week), desc(rcaNotes.createdAt)),
    db
      .select({
        weekStart: weeklyMetricResults.weekStart,
        actualValue: weeklyMetricResults.actualValue,
        targetValue: weeklyMetricResults.targetValue,
        status: weeklyMetricResults.status,
      })
      .from(weeklyMetricResults)
      .where(
        and(
          eq(weeklyMetricResults.employeeId, row.issue.employeeId),
          eq(weeklyMetricResults.kpiId, row.issue.kpiId),
        ),
      )
      .orderBy(weeklyMetricResults.weekStart),
    // Only ever meaningful for an AHT item, but cheap to fetch alongside
    // everything else regardless — the page decides whether to render it.
    db
      .select()
      .from(timeMotionStudies)
      .where(eq(timeMotionStudies.actionItemId, actionItemId))
      .orderBy(desc(timeMotionStudies.createdAt)),
  ]);

  return { ...row, history, acknowledgements: acks, metrics, notes, timeMotion };
}

/** Every status an action item can sit in, in workflow order — the Records status filter. */
export const RECORD_STATUSES = [
  "OPEN",
  "AWAITING_AGENT_ACKNOWLEDGEMENT",
  "ACKNOWLEDGED",
  "MONITORING",
  "SUSTAINED",
  "COMPLETED",
  "REOPENED",
] as const satisfies readonly IssueStatus[];

export function isRecordStatus(value: string | undefined): value is IssueStatus {
  return value !== undefined && (RECORD_STATUSES as readonly string[]).includes(value);
}

export interface CoachingRecordRow {
  actionItemId: string;
  actionItemCode: string;
  employeeId: string;
  employeeName: string;
  kpiName: string;
  kpiCode: string;
  status: IssueStatus;
  /** The most recent week folded into the item — the coaching date the archive sorts on. */
  latestWeek: string;
  /** Whoever wrote the RCA, or failing that the action plan. */
  filedBy: string | null;
  hasRca: boolean;
  hasPlan: boolean;
  hasTimeMotion: boolean;
  acknowledged: boolean;
}

export interface CoachingRecordFilter {
  /** Matched against the employee's name, case-insensitively. */
  search?: string;
  status?: IssueStatus;
  sort?: "newest" | "oldest";
}

const RECORD_LIMIT = 500;

/** A search term as an ILIKE pattern that matches it literally: the wildcards are escaped, not interpreted. */
function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The Records archive: one row per action item with something written
 * against it — an RCA, an action plan, a time-and-motion study or an
 * acknowledgement. An item nobody has started on is not a record yet; it is
 * on the Action Items page instead.
 *
 * Scoped exactly as the action-item list is (a supervisor's own team, a
 * manager's supervisors' teams, an administrator's whole org), and refused
 * outright for an agent: the archive is a leader's view. Unlike the
 * action-item list this does not hide items of KPIs that no longer open
 * items — an AHT record written before handle time moved to per-skill items
 * is still part of the employee's history.
 */
export async function getCoachingRecords(
  user: CurrentUser,
  filter: CoachingRecordFilter = {},
): Promise<CoachingRecordRow[]> {
  if (!canViewRecords(user)) return [];
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return [];

  const rcaAuthor = alias(users, "rca_author");
  const planAuthor = alias(users, "plan_author");
  const hasTimeMotion = sql<boolean>`exists (select 1 from ${timeMotionStudies} where ${timeMotionStudies.actionItemId} = ${actionItems.id})`;
  const acknowledged = sql<boolean>`exists (select 1 from ${acknowledgements} where ${acknowledgements.actionItemId} = ${actionItems.id})`;
  const latestWeek = sql<string>`coalesce(${performanceIssues.lastEvaluatedWeek}, ${performanceIssues.openedWeek})`;
  const search = filter.search?.trim();

  const rows = await db
    .select({
      actionItemId: actionItems.id,
      actionItemCode: actionItems.code,
      employeeId: employees.id,
      employeeName: employees.name,
      kpiName: kpiDefinitions.name,
      kpiCode: kpiDefinitions.code,
      status: performanceIssues.status,
      latestWeek,
      rcaId: rcaEntries.id,
      planId: actionPlans.id,
      rcaAuthor: rcaAuthor.name,
      planAuthor: planAuthor.name,
      hasTimeMotion,
      acknowledged,
    })
    .from(actionItems)
    .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
    .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
    .leftJoin(actionPlans, eq(actionPlans.actionItemId, actionItems.id))
    .leftJoin(rcaAuthor, eq(rcaAuthor.id, rcaEntries.createdBy))
    .leftJoin(planAuthor, eq(planAuthor.id, actionPlans.createdBy))
    .where(
      and(
        ids === "all" ? undefined : inArray(performanceIssues.employeeId, ids),
        filter.status ? eq(performanceIssues.status, filter.status) : undefined,
        search ? ilike(employees.name, containsPattern(search)) : undefined,
        or(isNotNull(rcaEntries.id), isNotNull(actionPlans.id), hasTimeMotion, acknowledged),
      ),
    )
    .orderBy(filter.sort === "oldest" ? asc(latestWeek) : desc(latestWeek), employees.name)
    .limit(RECORD_LIMIT);

  return rows.map((row) => ({
    actionItemId: row.actionItemId,
    actionItemCode: row.actionItemCode,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    kpiName: row.kpiName,
    kpiCode: row.kpiCode,
    status: row.status,
    latestWeek: row.latestWeek,
    filedBy: row.rcaAuthor ?? row.planAuthor ?? null,
    hasRca: row.rcaId !== null,
    hasPlan: row.planId !== null,
    hasTimeMotion: row.hasTimeMotion,
    acknowledged: row.acknowledged,
  }));
}

/**
 * One record in full for the read-only archive page: the same detail the
 * action-item page works from (getActionItemDetail, scoped the same way),
 * plus the names the page prints rather than the ids it stores — the root
 * cause category and who filed the RCA and the plan.
 */
export async function getCoachingRecordDetail(user: CurrentUser, actionItemId: string) {
  if (!canViewRecords(user)) return null;
  const detail = await getActionItemDetail(user, actionItemId);
  if (!detail) return null;

  const authorIds = [...new Set([detail.rca?.createdBy, detail.plan?.createdBy].filter((id): id is string => !!id))];
  const [authors, categories] = await Promise.all([
    authorIds.length > 0
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds))
      : Promise.resolve([]),
    detail.rca
      ? db
          .select({ label: rootCauseCategories.label })
          .from(rootCauseCategories)
          .where(eq(rootCauseCategories.id, detail.rca.rootCauseCategoryId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const nameOf = (id: string | undefined) => (id ? (authors.find((a) => a.id === id)?.name ?? null) : null);

  return {
    ...detail,
    rootCauseCategory: categories[0]?.label ?? null,
    rcaBy: nameOf(detail.rca?.createdBy),
    planBy: nameOf(detail.plan?.createdBy),
  };
}

export type CoachingRecordDetail = NonNullable<Awaited<ReturnType<typeof getCoachingRecordDetail>>>;

/** Weekly scorecard for one employee — the IDP view's metric table. */
export async function getEmployeeWeek(user: CurrentUser, employeeId: string, week: string | null) {
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return null;
  if (ids !== "all" && !ids.includes(employeeId)) return null;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee) return null;

  const metrics = week
    ? await db
        .select({
          kpiCode: kpiDefinitions.code,
          kpiName: kpiDefinitions.name,
          type: kpiDefinitions.type,
          direction: kpiDefinitions.direction,
          actualValue: weeklyMetricResults.actualValue,
          targetValue: weeklyMetricResults.targetValue,
          status: weeklyMetricResults.status,
          sampleSize: weeklyMetricResults.sampleSize,
        })
        .from(weeklyMetricResults)
        .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
        .where(
          and(eq(weeklyMetricResults.employeeId, employeeId), eq(weeklyMetricResults.weekStart, week)),
        )
        .orderBy(kpiDefinitions.name)
    : [];

  // Previous week's values, for the trend arrows.
  const previous = await db
    .select({
      kpiCode: kpiDefinitions.code,
      weekStart: weeklyMetricResults.weekStart,
      actualValue: weeklyMetricResults.actualValue,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(
      and(
        eq(weeklyMetricResults.employeeId, employeeId),
        week ? sql`${weeklyMetricResults.weekStart} < ${week}` : undefined,
      ),
    )
    .orderBy(desc(weeklyMetricResults.weekStart));

  const priorByKpi = new Map<string, number>();
  for (const row of previous) {
    if (!priorByKpi.has(row.kpiCode)) priorByKpi.set(row.kpiCode, row.actualValue);
  }

  const items = await getActionItems(user, { employeeId, openOnly: false });

  return { employee, metrics, priorByKpi, actionItems: items };
}

/**
 * Distinct weeks present in the ledger, newest first.
 *
 * A DISTINCT over the whole ledger, read by the Dashboard, Employees and
 * every employee page; the list changes only when a week is imported.
 */
export const getAvailableWeeks = cachedRead("available-weeks", [CACHE_TAG.imports], async (): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ week: weeklyMetricResults.weekStart })
    .from(weeklyMetricResults)
    .orderBy(desc(weeklyMetricResults.weekStart));
  return rows.map((r) => r.week);
});

export interface MatrixCell {
  actualValue: number;
  targetValue: number | null;
  /** Null where the figure carries no target, so nothing passes or fails it. */
  status: "pass" | "warning" | "fail" | null;
  sampleSize: number | null;
}

/**
 * Whether a row on the "Development item" table has stopped needing a
 * supervisor's attention right now: an unbroken pass across the exact most
 * recent `SUSTAINED_PASS_WEEKS` weeks, or nothing recorded against it at
 * all in that same window. The first means it is resolved; the second means
 * it has gone stale, sitting with no new weeks of tracking to show — the
 * KPI grid above this table is the full history regardless and is never
 * filtered by this, only the item list is.
 *
 * Requires the full window to be present before judging either way: fewer
 * weeks than that in the whole plan (too new to judge), or a mix of some
 * weeks with data and some without, both keep the row visible rather than
 * risk hiding something still actually in progress.
 */
export function isDevelopmentItemStale(
  weeks: string[],
  history: Map<string, { result: "pass" | "fail"; consecutiveCountAfter: number }>,
): boolean {
  const recentWeeks = weeks.slice(-SUSTAINED_PASS_WEEKS);
  if (recentWeeks.length < SUSTAINED_PASS_WEEKS) return false;

  const points = recentWeeks.map((week) => history.get(week));
  const noRecentData = points.every((point) => point === undefined);
  const passedThroughout = points.every((point) => point?.result === "pass");
  return noRecentData || passedThroughout;
}

export interface EmployeeMatrix {
  employee: typeof employees.$inferSelect;
  weeks: string[];
  kpis: Array<{ code: string; name: string; direction: string }>;
  /** `${kpiCode}|${week}` -> cell */
  cells: Map<string, MatrixCell>;
  ews: Map<string, { riskLevel: string; score: number }>;
  issues: Array<{
    actionItemId: string;
    actionItemCode: string;
    kpiCode: string;
    kpiName: string;
    status: string;
    openedWeek: string;
    consecutivePassingWeeks: number;
    hasRca: boolean;
    hasActionPlan: boolean;
    noteWeeks: Set<string>;
    /** week -> pass/fail and the running count after that week */
    history: Map<string, { result: "pass" | "fail"; consecutiveCountAfter: number }>;
  }>;
}

/**
 * Every week for one employee in a single result, so the development plan
 * can be read as one continuous picture rather than a week at a time.
 */
export async function getEmployeeMatrix(
  user: CurrentUser,
  employeeId: string,
): Promise<EmployeeMatrix | null> {
  const ids = await scopedEmployeeIds(user);
  if (ids === null || (Array.isArray(ids) && ids.length === 0)) return null;
  if (ids !== "all" && !ids.includes(employeeId)) return null;

  // Four independent reads, all keyed only on employeeId with no data
  // dependency between them — issued together rather than as four sequential
  // round trips, which is most of what made this page feel slow to open.
  const [[employee], rows, assessments, issueRows] = await Promise.all([
    db.select().from(employees).where(eq(employees.id, employeeId)).limit(1),
    db
      .select({
        week: weeklyMetricResults.weekStart,
        kpiCode: kpiDefinitions.code,
        kpiName: kpiDefinitions.name,
        direction: kpiDefinitions.direction,
        actualValue: weeklyMetricResults.actualValue,
        targetValue: weeklyMetricResults.targetValue,
        status: weeklyMetricResults.status,
        sampleSize: weeklyMetricResults.sampleSize,
      })
      .from(weeklyMetricResults)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
      // The grid is the scorecard (PLAN_KPI_CODES), not the list of what
      // opens items: PAR and MBO belong on it though they open nothing, and
      // the skills that do open items belong in the table below instead.
      .where(
        and(eq(weeklyMetricResults.employeeId, employeeId), inArray(kpiDefinitions.code, [...PLAN_KPI_CODES])),
      )
      .orderBy(weeklyMetricResults.weekStart, kpiDefinitions.name),
    db
      .select({
        week: ewsAssessments.week,
        riskLevel: ewsAssessments.riskLevel,
        score: ewsAssessments.score,
      })
      .from(ewsAssessments)
      .where(eq(ewsAssessments.employeeId, employeeId)),
    db
      .select({
        actionItemId: actionItems.id,
        actionItemCode: actionItems.code,
        issueId: performanceIssues.id,
        kpiCode: kpiDefinitions.code,
        kpiName: kpiDefinitions.name,
        status: performanceIssues.status,
        openedWeek: performanceIssues.openedWeek,
        consecutivePassingWeeks: performanceIssues.consecutivePassingWeeks,
        rcaId: rcaEntries.id,
        planId: actionPlans.id,
      })
      .from(actionItems)
      .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
      .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
      .leftJoin(actionPlans, eq(actionPlans.actionItemId, actionItems.id))
      // The development timeline is a list, so it honours the same flag every
      // other list does. MBO is assessed monthly and no longer opens weekly
      // work; its historical rows stay in the database but off this plan.
      .where(and(eq(performanceIssues.employeeId, employeeId), OPENS_ACTION_ITEMS))
      .orderBy(desc(performanceIssues.openedWeek)),
  ]);
  if (!employee) return null;

  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const kpiOrder = new Map<string, { code: string; name: string; direction: string }>();
  const cells = new Map<string, MatrixCell>();

  for (const row of rows) {
    kpiOrder.set(row.kpiCode, { code: row.kpiCode, name: row.kpiName, direction: row.direction });
    cells.set(`${row.kpiCode}|${row.week}`, {
      actualValue: row.actualValue,
      targetValue: row.targetValue,
      status: row.status,
      sampleSize: row.sampleSize,
    });
  }

  // The issue history and the notes depend only on what the first batch
  // returned (the issue ids), not on each other, so they are read together.
  const [historyRows, noteRows] = await Promise.all([
    issueRows.length
      ? db
          .select()
          .from(weeklyIssueHistory)
          .where(inArray(weeklyIssueHistory.performanceIssueId, issueRows.map((r) => r.issueId)))
      : Promise.resolve([]),
    issueRows.length
      ? db
          .select({ actionItemId: rcaNotes.actionItemId, week: rcaNotes.week })
          .from(rcaNotes)
          .where(inArray(rcaNotes.actionItemId, issueRows.map((r) => r.actionItemId)))
      : Promise.resolve([]),
  ]);
  return {
    employee,
    weeks,
    kpis: PLAN_KPI_CODES.flatMap((code) => kpiOrder.get(code) ?? []),
    cells,
    ews: new Map(assessments.map((a) => [a.week, { riskLevel: a.riskLevel, score: a.score }])),
    issues: issueRows.map((row) => ({
      actionItemId: row.actionItemId,
      actionItemCode: row.actionItemCode,
      kpiCode: row.kpiCode,
      kpiName: row.kpiName,
      status: row.status,
      openedWeek: row.openedWeek,
      consecutivePassingWeeks: row.consecutivePassingWeeks,
      hasRca: row.rcaId !== null,
      hasActionPlan: row.planId !== null,
      /** Weeks carrying a dated note against the root cause. */
      noteWeeks: new Set(
        noteRows.filter((n) => n.actionItemId === row.actionItemId).map((n) => n.week),
      ),
      history: new Map(
        historyRows
          .filter((h) => h.performanceIssueId === row.issueId)
          .map((h) => [h.week, { result: h.result, consecutiveCountAfter: h.consecutiveCountAfter }]),
      ),
    })),
  };
}


/**
 * One employee's display name, or null when they are outside the caller's
 * scope — the same rule the list and detail queries apply, so a filtered
 * list can be captioned with a name without a separate way to probe one.
 */
export async function getScopedEmployeeName(user: CurrentUser, employeeId: string): Promise<string | null> {
  const scope = employeeScope(user);
  if (scope === null) return null;
  const [row] = await db
    .select({ name: employees.name })
    .from(employees)
    .where(and(eq(employees.id, employeeId), scope === "all" ? undefined : scope))
    .limit(1);
  return row?.name ?? null;
}

/** Employee ids the caller may see — exported for period-based views. */
export async function getScopedEmployeeIds(user: CurrentUser): Promise<string[] | "all" | null> {
  return scopedEmployeeIds(user);
}

/** All employee ids in scope, resolved to a concrete list. */
export async function resolveScopedIds(user: CurrentUser): Promise<string[]> {
  const ids = await scopedEmployeeIds(user);
  if (ids === null) return [];
  if (ids !== "all") return ids;
  const rows = await db.select({ id: employees.id }).from(employees);
  return rows.map((r) => r.id);
}
