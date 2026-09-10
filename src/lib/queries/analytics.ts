import { type SQL, and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
import { db } from "@/lib/db/client";
import {
  employees,
  kpiDefinitions,
  performanceIssues,
  weeklyMetricResults,
} from "@/lib/db/schema";
import {
  joinPeriodOwner,
  managerOfRecord,
  periodOwnerSubquery,
  siteOfRecord,
  supervisorOfRecord,
  type PeriodOwner,
} from "./org-history";
import { OPENS_ACTION_ITEMS, OPEN_STATUSES } from "./performance";
import { getFactDateRange, getPeriodMetrics } from "./period-metrics";
import { eligibleForPeriod, hasReportableData } from "./eligibility";
import { periodContaining } from "./period";
import type { Period } from "./period";

/** Today in UTC, the fallback when there is no data to bound the period. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface KpiBreakdown {
  code: string;
  name: string;
  total: number;
  failing: number;
  failRate: number;
}

export interface TrendPoint {
  week: string;
  evaluated: number;
  failing: number;
  failRate: number;
}

export interface GroupBreakdown {
  label: string;
  employees: number;
  failing: number;
  failRate: number;
  openIssues: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
}

export interface AnalyticsSnapshot {
  /** Everyone matching the site/manager filters, regardless of the dates. */
  totalEmployees: number;
  /** Of those, how many have any evaluated result inside the range. */
  employeesWithData: number;
  evaluatedEmployees: number;
  failingEmployees: number;
  openIssues: number;
  kpis: KpiBreakdown[];
  trend: TrendPoint[];
  bySite: GroupBreakdown[];
  byManager: GroupBreakdown[];
  bySupervisor: GroupBreakdown[];
  statuses: StatusBreakdown[];
  /**
   * What "by site" / "by manager" / "by supervisor" actually describe: the
   * latest single week under the week grain, the latest whole month under
   * the month grain. Returned pre-labelled so the page never has to re-derive
   * it from a trend bucket — that was the earlier bug, since a month bucket's
   * key is a month-start and formatting it as a week silently produced a
   * fabricated 7-day range.
   */
  asOfLabel: string | null;
}

/**
 * Organization-wide analytics for the administrator's view.
 *
 * Deliberately read-only and aggregate: an administrator oversees the whole
 * operation rather than working individual action items, so this answers
 * "where is the organization struggling" rather than listing rows to act on.
 *
 * Only KPIs that open action items are counted, so the PAR components do
 * not double-count against the composite MBO result they feed.
 */
export type TrendGrain = "week" | "month";

export interface AnalyticsFilters {
  site?: string;
  manager?: string;
  /** Inclusive ISO dates bounding the weeks included. */
  weekFrom?: string;
  weekTo?: string;
  /** How the trend series is bucketed. Everything else is unaffected. */
  grain?: TrendGrain;
}

/**
 * Executive-report benchmarks — an aspirational read for the org as a whole,
 * not the KPI gates an individual result is scored against (those live on
 * `kpi_definitions` and stay exactly as configured). Changing a number here
 * changes only what tone a headline card takes, never anyone's rating.
 */
export const ANALYTICS_TARGETS = {
  passRate: 75,
  attainment: 95,
  openIssues: 120,
  criticalErrors: 30,
} as const;

/**
 * Cached per filter set and evicted by anything that could change it: an
 * import or masterlist, a ramp or skill-target change, an EWS assessment
 * (separation dates decide who counts) or an action item changing status
 * (the open-work counts). The snapshot is identical for every admin who
 * asks for the same range, and computing it is a dozen aggregate queries.
 * Cold computes go through one queue so two never fan out against the
 * pool together — which is also what lets the page request all of its
 * snapshots at once instead of one after the other.
 */
export const getAnalytics = cachedRead(
  "analytics-snapshot",
  [CACHE_TAG.imports, CACHE_TAG.reference, CACHE_TAG.ramp, CACHE_TAG.ews, CACHE_TAG.issues],
  (filters: AnalyticsFilters) => serialized("analytics", () => computeAnalytics(filters)),
);

async function computeAnalytics(filters: AnalyticsFilters): Promise<AnalyticsSnapshot> {
  // Everything below is cut by the org structure as it stood at the END of the
  // period being viewed, not as it stands today. Without this a realignment
  // retroactively moves a whole month's results to the new supervisor.
  const asOf = filters.weekTo ?? (await getFactDateRange())?.last ?? todayIso();
  // Unbounded start reads as "since the beginning of time," matching the
  // same sentinel eligibleForPeriod is given a few lines down — a filter
  // with no From date has never meant "just the end date" anywhere else on
  // this page, and the owner resolution should not either.
  const owner: PeriodOwner = periodOwnerSubquery({
    start: filters.weekFrom ?? "0001-01-01",
    end: asOf,
  });

  const scope = [
    filters.site ? eq(siteOfRecord(owner), filters.site) : undefined,
    filters.manager ? eq(managerOfRecord(owner), filters.manager) : undefined,
  ].filter(Boolean);

  const scopedEmployees = await db
    .select({ id: employees.id })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(scope.length ? and(...scope) : undefined);

  // Headcount for the range being reported, not the payroll as it stands.
  // Someone who left in July belongs in July's totals and not in August's,
  // decided by when they left rather than by their status now — the same
  // rule the MBO tree and the stack rank use.
  const ids = await eligibleForPeriod(
    scopedEmployees.map((e) => e.id),
    {
      granularity: "month",
      start: filters.weekFrom ?? "0001-01-01",
      end: asOf,
      label: "range",
    },
  );
  const empty: AnalyticsSnapshot = {
    totalEmployees: ids.length,
    employeesWithData: 0,
    evaluatedEmployees: 0,
    failingEmployees: 0,
    openIssues: 0,
    kpis: [],
    trend: [],
    bySite: [],
    byManager: [],
    bySupervisor: [],
    statuses: [],
    asOfLabel: null,
  };
  if (ids.length === 0) return empty;

  const window = [
    inArray(weeklyMetricResults.employeeId, ids),
    eq(kpiDefinitions.generatesActionItems, true),
    filters.weekFrom ? gte(weeklyMetricResults.weekStart, filters.weekFrom) : undefined,
    filters.weekTo ? lte(weeklyMetricResults.weekStart, filters.weekTo) : undefined,
  ].filter(Boolean);

  const kpiRowsPromise = db
    .select({
      code: kpiDefinitions.code,
      name: kpiDefinitions.name,
      total: count(),
      failing: sql<number>`count(*) filter (where ${weeklyMetricResults.status} = 'fail')::int`,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(and(...window))
    .groupBy(kpiDefinitions.code, kpiDefinitions.name);

  // A month bucket is keyed by its first day, so the same "start date"
  // contract holds for both grains and the chart needs no special case.
  const bucket =
    filters.grain === "month"
      ? sql<string>`date_trunc('month', ${weeklyMetricResults.weekStart})::date::text`
      : sql<string>`${weeklyMetricResults.weekStart}::text`;

  const trendRowsPromise = db
    .select({
      week: bucket,
      evaluated: sql<number>`count(distinct ${weeklyMetricResults.employeeId})::int`,
      failing: sql<number>`count(distinct ${weeklyMetricResults.employeeId}) filter (where ${weeklyMetricResults.status} = 'fail')::int`,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(and(...window))
    .groupBy(bucket)
    .orderBy(asc(bucket));

  // Action items are dated by the week whose failure opened them, so the
  // range filters on that. Without this the counts stayed at their all-time
  // totals while every figure beside them moved with the picker.
  const issueScope = [
    ...scope,
    OPENS_ACTION_ITEMS,
    filters.weekFrom ? gte(performanceIssues.openedWeek, filters.weekFrom) : undefined,
    filters.weekTo ? lte(performanceIssues.openedWeek, filters.weekTo) : undefined,
  ].filter(Boolean);

  // "Has data in range" counts any evaluated KPI, not only the ones that
  // open action items — someone with attendance but no production still has
  // data, and calling them absent would misrepresent the roster.
  const withDataPromise = db
    .select({ n: sql<number>`count(distinct ${weeklyMetricResults.employeeId})::int` })
    .from(weeklyMetricResults)
    .where(
      and(
        ...[
          inArray(weeklyMetricResults.employeeId, ids),
          filters.weekFrom ? gte(weeklyMetricResults.weekStart, filters.weekFrom) : undefined,
          filters.weekTo ? lte(weeklyMetricResults.weekStart, filters.weekTo) : undefined,
        ].filter(Boolean),
      ),
    );

  // The grouped tables below count failures in the most recent *week*, so that
  // value has to be a real week start. Deriving it from the trend's last
  // bucket breaks under the monthly grain, where the key is the first of the
  // month: weeks run Saturday-Friday, so the two coincide only in the roughly
  // one month in seven that begins on a Saturday. Every other month the join
  // matched nothing and each fail rate silently read 0% on a fully populated
  // table — which looks like good news rather than a bug.
  const latestWeekPromise = db
    .select({ week: sql<string | null>`max(${weeklyMetricResults.weekStart})::text` })
    .from(weeklyMetricResults)
    .where(
      and(
        ...[
          inArray(weeklyMetricResults.employeeId, ids),
          filters.weekFrom ? gte(weeklyMetricResults.weekStart, filters.weekFrom) : undefined,
          filters.weekTo ? lte(weeklyMetricResults.weekStart, filters.weekTo) : undefined,
        ].filter(Boolean),
      ),
    );

  const statusRowsPromise = db
    .select({ status: performanceIssues.status, n: count() })
    .from(performanceIssues)
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    // issueScope filters on managerOfRecord/siteOfRecord when those filters are
    // set, and both reference the owner subquery's columns — without this
    // join Postgres has nothing to resolve them against and the whole query
    // throws, which is exactly what picking a manager did here.
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(issueScope.length ? and(...issueScope) : undefined)
    .groupBy(performanceIssues.status);

  // Three independent aggregates: issue them together and pay one round
  // trip's latency instead of three.
  const [kpiRows, trendRows, statusRows, [withData], [latestWeekRow]] = await Promise.all([
    kpiRowsPromise,
    trendRowsPromise,
    statusRowsPromise,
    withDataPromise,
    latestWeekPromise,
  ]);

  const latestWeek = latestWeekRow?.week ?? undefined;
  // The window "by site"/"by manager"/"by supervisor" aggregate over: one
  // week under the week grain (unchanged), the whole month containing that
  // week under the month grain — otherwise switching to "Trend by: Month"
  // relabels the same single week rather than actually widening it.
  const latestPeriod = latestWeek
    ? periodContaining(filters.grain === "month" ? "month" : "week", latestWeek)
    : null;

  // The group breakdowns put a per-supervisor headcount right beside the
  // MBO tree's own count for the same people (manager-overview.tsx renders
  // "Team" from getMboOverview and "X of Y evaluated" from this function on
  // the same row). `ids` only excludes people who separated — an
  // attendance-only agent is still in it, since attrition never touched
  // them — so without this, that agent inflates the "evaluated" denominator
  // shown right next to a Team count that has already excluded them, and
  // reads as if the exclusion silently stopped applying to them.
  const reportingIds = new Set(
    await hasReportableData(ids, {
      granularity: "month",
      start: filters.weekFrom ?? "0001-01-01",
      end: asOf,
      label: "range",
    }),
  );

  const groupBy = async (column: SQL<string | null>) => {
    const rowsPromise = db
      .select({
        label: column,
        employees: sql<number>`count(distinct ${employees.id})::int`,
        // Only KPIs that open action items count as a failure here, matching
        // the KPI breakdown above — otherwise a PAR component and the MBO it
        // feeds would both mark the same person failing. A person counts as
        // failing if they failed on ANY day inside the window, matching how
        // the trend chart's own month bucket counts a distinct employee once
        // regardless of how many of that month's weeks they failed.
        failing: sql<number>`count(distinct ${employees.id}) filter (where ${weeklyMetricResults.status} = 'fail' and ${kpiDefinitions.generatesActionItems})::int`,
      })
      .from(employees)
      .leftJoin(
        weeklyMetricResults,
        and(
          eq(weeklyMetricResults.employeeId, employees.id),
          // No reporting week starts inside the range — a month whose
          // first Saturday is still ahead, say — means nobody has been
          // evaluated for it yet, and the join must match nothing. Left
          // unbounded it matched every week ever imported, so a September
          // with no data yet showed all-time failure counts on every row
          // beside a summary saying nobody had data.
          latestPeriod
            ? and(
                gte(weeklyMetricResults.weekStart, latestPeriod.start),
                lte(weeklyMetricResults.weekStart, latestPeriod.end),
              )
            : sql`false`,
        ),
      )
      .leftJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
      .leftJoin(owner, joinPeriodOwner(owner))
      // Narrowed to the same people the headline counts, further narrowed to
      // those with something to actually evaluate. Without the first, the
      // group headcounts sum past the total on the same screen; without the
      // second, an attendance-only agent counts toward a supervisor's
      // "evaluated" figure with nothing that could ever fail.
      .where(and(inArray(employees.id, [...reportingIds]), ...scope))
      .groupBy(column);

    const issuesPromise = db
      .select({
        label: column,
        openIssues: sql<number>`count(*) filter (where ${performanceIssues.status} in ('OPEN','AWAITING_AGENT_ACKNOWLEDGEMENT','ACKNOWLEDGED','MONITORING','SUSTAINED','REOPENED'))::int`,
      })
      .from(performanceIssues)
      .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
      .leftJoin(owner, joinPeriodOwner(owner))
      // Same narrowing as the headcount beside it, for the same reason.
      .where(and(inArray(employees.id, [...reportingIds]), ...issueScope))
      .groupBy(column);

    const [rows, issues] = await Promise.all([rowsPromise, issuesPromise]);
    const issuesBy = new Map(issues.map((i) => [i.label, i.openIssues]));

    return rows
      .filter((r) => r.label)
      .map((r) => {
        // The headcount is "with reportable data in the range", which is
        // the denominator the rows label as "evaluated". With no reporting
        // week in the range that denominator is nobody, whatever the daily
        // facts say — the same rule the headline counts above follow.
        const employees = latestPeriod ? r.employees : 0;
        const failing = latestPeriod ? r.failing : 0;
        return {
          label: r.label as string,
          employees,
          failing,
          failRate: employees > 0 ? (failing / employees) * 100 : 0,
          openIssues: issuesBy.get(r.label) ?? 0,
        };
      })
      .sort((a, b) => b.failRate - a.failRate);
  };

  const [bySite, byManager, bySupervisor] = await Promise.all([
    groupBy(siteOfRecord(owner)),
    groupBy(managerOfRecord(owner)),
    groupBy(supervisorOfRecord(owner)),
  ]);

  const latest = trendRows.at(-1);

  return {
    totalEmployees: ids.length,
    employeesWithData: withData?.n ?? 0,
    evaluatedEmployees: latest?.evaluated ?? 0,
    failingEmployees: latest?.failing ?? 0,
    openIssues: statusRows
      .filter((s) => OPEN_STATUSES.includes(s.status as never))
      .reduce((sum, s) => sum + s.n, 0),
    kpis: kpiRows
      .map((r) => ({
        code: r.code,
        name: r.name,
        total: r.total,
        failing: r.failing,
        failRate: r.total > 0 ? (r.failing / r.total) * 100 : 0,
      }))
      .sort((a, b) => b.failRate - a.failRate),
    trend: trendRows.map((r) => ({
      week: r.week,
      evaluated: r.evaluated,
      failing: r.failing,
      failRate: r.evaluated > 0 ? (r.failing / r.evaluated) * 100 : 0,
    })),
    bySite,
    byManager,
    bySupervisor,
    statuses: statusRows.map((s) => ({ status: s.status, count: s.n })),
    asOfLabel: latestPeriod?.label ?? null,
  };
}

export interface MboNode {
  label: string;
  /** Mean MBO percentage across the people beneath this node. */
  mbo: number | null;
  /** Share of scored people who cleared every gate — the business's "pass rate". */
  passRate: number | null;
  /** How many of them cleared every applicable gate. */
  passing: number;
  scored: number;
  headcount: number;
  employeeId?: string;
  eid?: string;
  children: MboNode[];
}

export interface TopAgent {
  employeeId: string;
  eid: string;
  name: string;
  supervisor: string | null;
  /** The PAR production rating, 1.00–5.00 — the same key the stack rank sorts on. */
  productionRate: number;
  mbo: number | null;
}

export interface MboOverview {
  sites: MboNode[];
  /** Mean MBO attainment across scored people. */
  overall: number | null;
  /** Share of scored people clearing every gate. This is the headline figure. */
  passRate: number | null;
  scored: number;
  passing: number;
  /**
   * Everyone in the span with a production rating, best first.
   *
   * Ranked on PAR rather than MBO so this says something the MBO tree beside
   * it does not: MBO is a share of gates cleared and saturates at 100%, which
   * cannot separate the top of a team where everyone clears every gate.
   * The caller takes as many as it has room for.
   */
  topAgents: TopAgent[];
}

/**
 * MBO attainment rolled up site → manager → supervisor → employee.
 *
 * MBO is stored per employee-week as the share of applicable gates met, so
 * a group's figure is the mean of its members' own percentages: averaging
 * the weekly values first keeps a person with more weeks of data from
 * counting more than once at the group level.
 *
 * People with no MBO result in the window still appear in the headcount but
 * are left out of the average — absent data is not a failing score.
 */
export const getMboOverview = cachedRead(
  "mbo-overview",
  [CACHE_TAG.imports, CACHE_TAG.reference, CACHE_TAG.ramp, CACHE_TAG.ews],
  (filters: AnalyticsFilters) => serialized("analytics", () => computeMboOverview(filters)),
);

async function computeMboOverview(filters: AnalyticsFilters): Promise<MboOverview> {
  // Re-aggregate the whole range once and apply the gates to that, rather
  // than averaging each week's gate-share and demanding the average be 100.
  // Those are not the same measure: someone who missed one gate in one week
  // of four averages 91.7% and fails the second test while comfortably
  // passing the first. The business's own figure is the first one.
  // Each bound is honoured independently, matching getAnalytics. Requiring
  // both meant a one-sided filter — "since 1 September", with the To field left
  // empty — silently fell back to the entire imported history, so the MBO card
  // and tree reported all-time figures beside cards labelled as September.
  const factRange = await getFactDateRange();
  const range =
    filters.weekFrom || filters.weekTo
      ? {
          start: filters.weekFrom ?? factRange?.first ?? null,
          end: filters.weekTo ?? factRange?.last ?? null,
        }
      : factRange
        ? { start: factRange.first, end: factRange.last }
        : null;

  if (!range || range.start === null || range.end === null) {
    return { sites: [], overall: null, scored: 0, passing: 0, passRate: null, topAgents: [] };
  }

  const period: Period = {
    // Anything but "week" re-aggregates from daily facts; "week" would read
    // the labelled weekly ledger and reintroduce the averaging.
    granularity: "month",
    start: range.start,
    end: range.end,
    label: `${range.start} to ${range.end}`,
  };

  // The tree is built from the team that actually ran the range — whoever
  // held each person for the most days of it, not just its last one. A
  // realignment on the range's final day must not hand the whole range's
  // results to whoever inherited the person that one day.
  const owner = periodOwnerSubquery(period);
  let roster = await db
    .select({
      employeeId: employees.id,
      eid: employees.eid,
      name: employees.name,
      site: siteOfRecord(owner),
      manager: managerOfRecord(owner),
      supervisor: supervisorOfRecord(owner),
    })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(
      and(
        ...[
          filters.site ? eq(siteOfRecord(owner), filters.site) : undefined,
          filters.manager ? eq(managerOfRecord(owner), filters.manager) : undefined,
        ].filter(Boolean),
      ),
    );

  // Who counted for this period, not who is employed today. A separated
  // employee stays in the months they worked and leaves the ones they did
  // not, judged on the date they left rather than on their status now.
  //
  // Present in the roster is not the same as reporting to anyone. A new
  // hire still in Nesting, someone approved for leave, or an SME with no
  // assigned book of work all carry an attendance mark and nothing else —
  // they have not produced a single measurable result yet, so counting them
  // toward their nominal supervisor's headcount overstates it with people
  // who cannot pass or fail an MBO gate. A supervisor whose whole team is
  // in this state simply has no eligible leaves left, and drops out of the
  // tree entirely — which is also the correct answer for "does this
  // supervisor have anyone to show under their manager this month."
  //
  // Both are independent per-employee lookups over the same starting
  // roster — neither's result feeds the other — so they run concurrently
  // against the full roster and get intersected afterward, rather than one
  // waiting on the other's already-filtered list for no reason.
  const rosterIds = roster.map((r) => r.employeeId);
  const [eligible, reporting] = await Promise.all([
    eligibleForPeriod(rosterIds, period).then((ids) => new Set(ids)),
    hasReportableData(rosterIds, period),
  ]);
  roster = roster.filter((r) => eligible.has(r.employeeId) && reporting.has(r.employeeId));

  const metrics = await getPeriodMetrics(roster.map((r) => r.employeeId), period);
  const mboByEmployee = new Map(
    metrics.filter((m) => m.kpiCode === "MBO").map((m) => [m.employeeId, m.actualValue]),
  );
  const rows = roster.map((r) => ({ ...r, mbo: mboByEmployee.get(r.employeeId) ?? null }));

  // The same pass already carries every KPI, PAR included, so ranking the
  // span costs nothing extra. Someone without a rating this period is left
  // out rather than ranked last: this is a leaderboard, not a roster.
  const parByEmployee = new Map(
    metrics
      .filter((m) => m.kpiCode === "PRODUCTION_RATE")
      .map((m) => [m.employeeId, Number(m.actualValue)]),
  );
  const topAgents: TopAgent[] = rows
    .flatMap((r) => {
      const productionRate = parByEmployee.get(r.employeeId);
      return productionRate === undefined || !Number.isFinite(productionRate)
        ? []
        : [
            {
              employeeId: r.employeeId,
              eid: r.eid,
              name: r.name,
              supervisor: r.supervisor,
              productionRate,
              mbo: r.mbo === null ? null : Number(r.mbo),
            },
          ];
    })
    .sort((a, b) => b.productionRate - a.productionRate || a.name.localeCompare(b.name));

  const UNASSIGNED = "Unassigned";

  const leaf = (r: (typeof rows)[number]): MboNode => {
    const mbo = r.mbo === null ? null : Number(r.mbo);
    const passes = mbo !== null && mbo >= 100;
    return {
      label: r.name,
      mbo,
      passRate: mbo === null ? null : passes ? 100 : 0,
      passing: passes ? 1 : 0,
      scored: mbo !== null ? 1 : 0,
      headcount: 1,
      employeeId: r.employeeId,
      eid: r.eid,
      children: [],
    };
  };

  /** Roll children up into a parent, averaging only the members that scored. */
  const summarize = (label: string, children: MboNode[]): MboNode => {
    const scored = children.reduce((n, c) => n + c.scored, 0);
    const weighted = children.reduce((sum, c) => sum + (c.mbo ?? 0) * c.scored, 0);
    const passing = children.reduce((n, c) => n + c.passing, 0);
    return {
      label,
      mbo: scored > 0 ? weighted / scored : null,
      passRate: scored > 0 ? (passing / scored) * 100 : null,
      passing,
      scored,
      headcount: children.reduce((n, c) => n + c.headcount, 0),
      children: children.sort((a, b) => (b.mbo ?? -1) - (a.mbo ?? -1)),
    };
  };

  const bySite = new Map<string, Map<string, Map<string, MboNode[]>>>();
  for (const row of rows) {
    const site = row.site || UNASSIGNED;
    const manager = row.manager || UNASSIGNED;
    const supervisor = row.supervisor || UNASSIGNED;

    const managers = bySite.get(site) ?? new Map();
    bySite.set(site, managers);
    const supervisors = managers.get(manager) ?? new Map();
    managers.set(manager, supervisors);
    supervisors.set(supervisor, [...(supervisors.get(supervisor) ?? []), leaf(row)]);
  }

  const sites = [...bySite.entries()]
    .map(([site, managers]) =>
      summarize(
        site,
        [...managers.entries()].map(([manager, supervisors]) =>
          summarize(
            manager,
            [...supervisors.entries()].map(([supervisor, people]) =>
              summarize(supervisor, people),
            ),
          ),
        ),
      ),
    )
    .sort((a, b) => (b.passRate ?? -1) - (a.passRate ?? -1));

  const scored = sites.reduce((n, s) => n + s.scored, 0);
  const passing = sites.reduce((n, s) => n + s.passing, 0);
  return {
    sites,
    overall: scored > 0 ? sites.reduce((sum, s) => sum + (s.mbo ?? 0) * s.scored, 0) / scored : null,
    passRate: scored > 0 ? (passing / scored) * 100 : null,
    scored,
    passing,
    topAgents,
  };
}

/** Distinct sites and managers, for the analytics filters. */
export async function getAnalyticsFacets() {
  const rows = await db
    .selectDistinct({ site: employees.site, manager: employees.managerName })
    .from(employees);

  return {
    sites: [...new Set(rows.map((r) => r.site).filter(Boolean))].sort() as string[],
    managers: [...new Set(rows.map((r) => r.manager).filter(Boolean))].sort() as string[],
  };
}
