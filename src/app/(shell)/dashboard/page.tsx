import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  Card,
  CardHeader,
  EmptyState,
  PageBand,
  StatusBadge,
  formatMetric,
} from "@/components/ui";
import { AdminAnalytics } from "./admin-analytics";
import { ManagerOverview } from "./manager-overview";
import { AgentPerformance, type AgentKpi } from "./agent-performance";
import { SupervisorOverview, type TeamKpi } from "./supervisor-overview";
import { TeamAgentTable } from "./team-agent-table";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getAttentionRows,
  getAvailableWeeks,
  getLatestWeek,
  getLatestWeekInScope,
  getTeamSummary,
} from "@/lib/queries/performance";
import { getOpenIssueCounts, getOverdueCount, getSupervisorRollup } from "@/lib/queries/roster";
import { resolveScopedIds } from "@/lib/queries/performance";
import { reportingScopeIds } from "@/lib/queries/org-history";
import { getFactDateRange, getPeriodMetrics } from "@/lib/queries/period-metrics";
import { getTeamPeriodComparison } from "@/lib/queries/my-stats";
import { getEmployeeKpiTrend } from "@/lib/queries/trend";
import { getTeamKpiTrend } from "@/lib/queries/team-trend";
import { parseGranularity, periodContaining, periodsBetween } from "@/lib/queries/period";
import { PeriodPicker } from "@/components/period-picker";

/** Today's date as YYYY-MM-DD, for overdue comparisons. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const ROLE_HEADLINE: Record<string, string> = {
  admin: "Organization overview",
  manager: "My organization",
  supervisor: "My team",
  agent: "My performance",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    granularity?: string;
    period?: string;
    site?: string;
    manager?: string;
    weekFrom?: string;
    weekTo?: string;
    grain?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  // Every query below is a round trip to the database, so independent ones
  // are issued together rather than in sequence — the page is otherwise
  // dominated by latency it never needed to pay.
  const [params, weeks, latest, scopedLatest, range, cookieStore] = await Promise.all([
    searchParams,
    getAvailableWeeks(),
    getLatestWeek(),
    getLatestWeekInScope(user),
    getFactDateRange(),
    cookies(),
  ]);

  // Administrators get an aggregate, read-only report rather than the
  // operational tables: they oversee the whole operation and do not own the
  // individual action items those tables exist to work through.
  if (user.role === "admin") {
    return (
      <>
        <PageBand
          title="Organization overview"
          subtitle="Read-only analytics across every site, manager and team"
        />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <AdminAnalytics
            weeks={weeks}
            filters={{
              site: params.site || undefined,
              manager: params.manager || undefined,
              weekFrom: params.weekFrom || undefined,
              weekTo: params.weekTo || undefined,
              grain: params.grain === "month" ? "month" : undefined,
            }}
          />
        </main>
      </>
    );
  }

  // Reporting period. Weeks still drive the action-item engine; this only
  // changes what the summary above is measured over. Dashboard, MBO and
  // Stack Rank share one PeriodPicker control and remember the same choice
  // between them (see period-picker.tsx) — an explicit URL param still wins,
  // so a shared link or the back button shows exactly what it captured.
  const granularity = parseGranularity(
    params.granularity ?? cookieStore.get("periodGranularity")?.value,
  );
  const periods = range ? periodsBetween(granularity, range.first, range.last) : [];
  // Open on the newest period this viewer has results for, not the newest
  // that exists. The period list is built from the whole imported range, so
  // a team whose data ends earlier than someone else's would otherwise open
  // on a period that is empty for them and look like a total collapse.
  const inScope = scopedLatest
    ? periods.find((p) => p.start <= scopedLatest && scopedLatest <= p.end)
    : undefined;
  const period =
    periods.find((p) => p.start === params.period) ??
    (!params.period
      ? periods.find((p) => p.start === cookieStore.get("periodStart")?.value)
      : undefined) ??
    inScope ??
    periods[0] ??
    (latest ? periodContaining("week", latest) : null);

  // The attention table and issue counts stay weekly, since an action item
  // belongs to a week.
  const week = params.week && weeks.includes(params.week) ? params.week : (scopedLatest ?? latest);

  // Managers get a per-supervisor breakdown; supervisors and agents have no
  // one below them to roll up. (Admins returned above with the org-wide view.)
  const showsRollup = user.role === "manager";

  const [scopedIds, summary, attention, rollup, overdue] = await Promise.all([
    resolveScopedIds(user),
    getTeamSummary(user, week),
    getAttentionRows(user, week, 50),
    showsRollup ? getSupervisorRollup(user, week) : Promise.resolve([]),
    getOverdueCount(user, todayIso()),
  ]);

  // Depends on the scope resolved above, so these cannot join the batch.
  // The stat cards follow the selected period; the attention table below is
  // weekly, because an action item belongs to a week — so both grains are
  // fetched and each panel says which one it is showing.
  const weekPeriod = week ? periodContaining("week", week) : null;
  const [periodMetrics, weekMetrics] = await Promise.all([
    period ? getPeriodMetrics(scopedIds, period) : Promise.resolve([]),
    weekPeriod && weekPeriod.start !== period?.start
      ? getPeriodMetrics(scopedIds, weekPeriod)
      : Promise.resolve(null),
  ]).then(([p, w]) => [p, w ?? p] as const);

  const periodByEmployee = new Map<string, { fail: number; warn: number }>();
  for (const metric of periodMetrics) {
    const entry = periodByEmployee.get(metric.employeeId) ?? { fail: 0, warn: 0 };
    if (metric.status === "FAIL") entry.fail += 1;
    if (metric.status === "WARNING") entry.warn += 1;
    periodByEmployee.set(metric.employeeId, entry);
  }
  const periodFailing = [...periodByEmployee.values()].filter((e) => e.fail > 0).length;
  const periodAtRisk = [...periodByEmployee.values()].filter((e) => e.fail === 0 && e.warn > 0).length;
  // Only people with a result this period can be classified; the roster is
  // usually larger, and that difference is unmeasured rather than passing.
  const periodMeasured = periodByEmployee.size;

  // Which KPIs actually had data. A boundary week can carry only attendance,
  // and reporting that as "nothing failing" reads as an all-clear when the
  // truth is that almost nothing was measured.
  const evaluatedKpis = [...new Set(weekMetrics.map((m) => m.kpiName))];

  // Production Rate (PAR) on its own terms. The generic "passing" count asks
  // whether every measured KPI held; this asks the single question the
  // business rates production on, so the two legitimately differ.
  const isAgent = user.role === "agent";
  // An agent's own KPIs, headline measures first rather than query order.
  const KPI_ORDER = [
    "MBO", "PRODUCTION_RATE", "CPH", "AHT", "QUALITY", "DPU", "DPO",
    "ATTENDANCE", "NPS", "CRITICAL_ERRORS",
  ];
  const myKpis = isAgent
    ? [...periodMetrics].sort(
        (a, b) => KPI_ORDER.indexOf(a.kpiCode) - KPI_ORDER.indexOf(b.kpiCode),
      )
    : [];

  const parMetrics = periodMetrics.filter((m) => m.kpiCode === "PRODUCTION_RATE");
  const parPassing = parMetrics.filter((m) => m.status === "PASS").length;
  const thinCoverage = weekMetrics.length > 0 && evaluatedKpis.length <= 2;

  // MBO is a composite gate rather than a threshold, so it is counted on its
  // own terms and links to the breakdown rather than the roster.
  const mboByEmployee = periodMetrics.filter((m) => m.kpiCode === "MBO");
  const mboPassing = mboByEmployee.filter((m) => m.actualValue >= 100).length;
  const mboFailing = mboByEmployee.length - mboPassing;
  const mboScored = mboByEmployee.length;
  const mboHref = (status: "pass" | "fail") =>
    `/mbo?granularity=${granularity}${period ? `&period=${period.start}` : ""}&status=${status}`;

  // Reporting scope, not operational scope: this table answers "whose numbers
  // made up my team in the period being viewed," so a realignment since then
  // must not silently add or drop rows — see org-history.ts. resolveScopedIds
  // (used for the cards above) intentionally stays on "who I manage now."
  const comparisonIds = period ? await reportingScopeIds(user, period.end) : [];

  // Everyone with a linked employee record gets the comparison matrix. For an
  // agent it is a single row — their own KPIs against the previous period —
  // which is exactly the comparison the cards above cannot show.
  const showsComparison = comparisonIds.length > 0;
  // Follows the period picker, so a week is compared against the previous
  // week rather than always against last month.
  const comparison =
    showsComparison && period ? await getTeamPeriodComparison(comparisonIds, period) : null;

  const unscoped = !user.employeeEid && user.role !== "manager";

  // An agent's own row from the comparison above, so each KPI can carry its
  // change without a second query. Case rate rides in on the same row: it is
  // a skill metric with no KPI definition, so it never appears in
  // periodMetrics, but for a case-rate agent it is the only output figure
  // they have — see getCaseRates in my-stats.ts.
  const myRow = isAgent ? (comparison?.rows[0] ?? null) : null;
  const myKpiCells = myRow?.cells ?? {};
  const agentKpis: AgentKpi[] = isAgent
    ? [
        ...myKpis.map((m) => ({
          code: m.kpiCode,
          name: m.kpiName,
          value: m.actualValue,
          target: m.targetValue,
          status: m.status as string | null,
          delta: myKpiCells[m.kpiCode]?.delta ?? null,
          improved: myKpiCells[m.kpiCode]?.improved ?? null,
          previous: myKpiCells[m.kpiCode]?.previous ?? null,
        })),
        ...(myKpiCells.CASE_RATE?.current !== null && myKpiCells.CASE_RATE?.current !== undefined
          ? [
              {
                code: "CASE_RATE",
                name: "Case Rate",
                value: myKpiCells.CASE_RATE.current,
                // No target on the cell, but the verdict travels with it: the
                // agent's own skill mix decided it upstream.
                target: null,
                status: myKpiCells.CASE_RATE.status,
                delta: myKpiCells.CASE_RATE.delta,
                improved: myKpiCells.CASE_RATE.improved,
                previous: myKpiCells.CASE_RATE.previous,
              },
            ]
          : []),
      ]
    : [];

  // The trend is deliberately weekly and independent of the period picker
  // above: the cards answer "how did this period go", the chart answers
  // "which way am I heading", and a month-grained trend of three points
  // cannot answer the second. Twelve weeks are fetched and the client trims
  // to six, so switching the range costs no round trip.
  const trendSeries =
    isAgent && scopedIds.length > 0 && weeks.length > 0
      ? await getEmployeeKpiTrend(scopedIds[0], weeks.slice(0, 12))
      : [];

  const isSupervisor = user.role === "supervisor";

  // The team's own figures, one row per KPI: the mean of the agents scored on
  // it, and how many of them were below target. The mean alone hides the
  // shape of a team, so the count travels with it everywhere it is shown.
  const teamKpis: TeamKpi[] = isSupervisor
    ? [...
        periodMetrics
          .reduce((acc, m) => {
            const entry = acc.get(m.kpiCode) ?? {
              code: m.kpiCode,
              name: m.kpiName,
              sum: 0,
              targetSum: 0,
              targets: 0,
              below: 0,
              scored: 0,
            };
            entry.sum += m.actualValue;
            entry.scored += 1;
            if (m.status === "FAIL") entry.below += 1;
            if (m.targetValue !== null) {
              entry.targetSum += m.targetValue;
              entry.targets += 1;
            }
            acc.set(m.kpiCode, entry);
            return acc;
          }, new Map<string, { code: string; name: string; sum: number; targetSum: number; targets: number; below: number; scored: number }>())
          .values(),
      ]
        .map((e) => ({
          code: e.code,
          name: e.name,
          avg: e.sum / e.scored,
          // Targets differ per agent — a ramping agent's are lower — so the
          // cell shows the team's mean target rather than one person's.
          target: e.targets > 0 ? e.targetSum / e.targets : null,
          below: e.below,
          scored: e.scored,
        }))
    : [];

  const [teamSeries, openByEmployee] = await Promise.all([
    isSupervisor && scopedIds.length > 0 && weeks.length > 0
      ? getTeamKpiTrend(scopedIds, weeks.slice(0, 12))
      : Promise.resolve([]),
    isSupervisor ? getOpenIssueCounts(scopedIds) : Promise.resolve(new Map<string, number>()),
  ]);

  return (
    <>
      <PageBand
        title={ROLE_HEADLINE[user.role] ?? "Dashboard"}
        subtitle={period ? period.label : "No performance data imported yet"}
        action={
          period && periods.length > 0 ? (
            <PeriodPicker
              basePath="/dashboard"
              granularity={granularity}
              periods={periods}
              selected={period}
            />
          ) : undefined
        }
      />

      <main className="mx-auto max-w-7xl px-6 py-8">

        {user.role === "manager" && (
          <ManagerOverview
            managerName={user.managerName ?? user.name}
            period={period}
            weeks={weeks}
            rollup={rollup}
            comparison={comparison}
            actionItems={{
              open: summary.openIssues,
              awaiting: summary.awaitingAcknowledgement,
              monitoring: summary.monitoring,
              sustained: summary.sustained,
              overdue,
            }}
          />
        )}

        {unscoped && (
          <Card className="mb-6">
            <div className="px-6 py-4">
              <p className="text-sm font-medium text-ink">Account not linked to employee data</p>
              <p className="mt-1 text-sm text-muted">
                An administrator needs to link this account to an employee ID before your team&apos;s
                data will appear.
              </p>
            </div>
          </Card>
        )}

        {isAgent ? (
          /*
           * An agent is a team of one, so the aggregate cards above say
           * nothing they do not already know ("Me: 1"). What they need is
           * their own numbers against their own targets.
           */
          agentKpis.length === 0 ? (
            <Card>
              <EmptyState
                title="No data for this period"
                description="Your KPIs appear here once performance data covering this period has been imported. Try a wider period."
              />
            </Card>
          ) : (
            <AgentPerformance
              kpis={agentKpis}
              series={trendSeries}
              periodLabel={period?.label ?? "this period"}
              actionItems={{
                open: summary.openIssues,
                awaiting: summary.awaitingAcknowledgement,
                monitoring: summary.monitoring,
                sustained: summary.sustained,
                overdue,
              }}
            />
          )
        ) : isSupervisor ? (
          /*
           * A supervisor works down people, so their view leads with how many
           * agents are below target and which measure most of the team is
           * missing — not with a wall of team-wide tiles that says neither.
           */
          teamKpis.length === 0 ? (
            <Card>
              <EmptyState
                title="No data for this period"
                description="Your team's KPIs appear here once performance data covering this period has been imported. Try a wider period."
              />
            </Card>
          ) : (
            <>
              <SupervisorOverview
                kpis={teamKpis}
                series={teamSeries}
                periodLabel={period?.label ?? "this period"}
                stats={{
                  failing: periodFailing,
                  atRisk: periodAtRisk,
                  measured: periodMeasured,
                  total: summary.totalEmployees,
                  parPassing,
                  parScored: parMetrics.length,
                  mboPassing,
                  mboScored,
                  mboFailing,
                  mboFailHref: mboHref("fail"),
                }}
                actionItems={{
                  open: summary.openIssues,
                  awaiting: summary.awaitingAcknowledgement,
                  monitoring: summary.monitoring,
                  sustained: summary.sustained,
                  overdue,
                }}
              />
              {comparison && (
                <TeamAgentTable data={comparison} openByEmployee={openByEmployee} />
              )}
            </>
          )
        ) : null}

        <Card className="mt-6">
          <CardHeader
            title="Attention required"
            subtitle={
              week
                ? "Metrics that failed their threshold this week"
                : "Import performance data to populate this view"
            }
            action={
              <Link
                href="/action-items"
                className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
              >
                All action items
              </Link>
            }
          />

          {attention.length === 0 ? (
            <EmptyState
              title={thinCoverage ? "Barely any data this period" : "Nothing failing this week"}
              description={
                periodMetrics.length === 0
                  ? "No performance data was recorded for this period, so nothing could be evaluated."
                  : thinCoverage
                    ? `Only ${evaluatedKpis.join(" and ")} had data for this period, so this is not an all-clear — try a wider range.`
                    : "Every tracked metric met its threshold for the selected week."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">KPI</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">Result</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">Target</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">Sample</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Action item</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                    <th className="px-6 py-2.5 font-semibold text-ink">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((row) => (
                    <tr
                      key={`${row.employeeId}-${row.kpiCode}`}
                      className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100"
                    >
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees/${row.employeeId}${week ? `?week=${week}` : ""}`}
                          prefetch={false}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">{row.employeeEid}</span>
                      </td>
                      <td className="px-3 py-2 text-ink">{row.kpiName}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-fail">
                        {formatMetric(row.actualValue, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-muted">
                        {formatMetric(row.targetValue, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {row.sampleSize === null ? (
                          <span className="text-muted">—</span>
                        ) : row.sampleSize <= 2 ? (
                          <span
                            className="rounded bg-warn-bg px-1.5 py-0.5 text-warn"
                            title="Very few source rows behind this figure — read with caution"
                          >
                            {row.sampleSize}
                          </span>
                        ) : (
                          <span className="text-muted">{row.sampleSize}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {row.actionItemCode ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.issueStatus ? <StatusBadge status={row.issueStatus} /> : "—"}
                      </td>
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees/${row.employeeId}${week ? `?week=${week}` : ""}`}
                          prefetch={false}
                          className="text-sm font-medium text-orange-brand underline-offset-4 hover:underline"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
