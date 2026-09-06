import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  Card,
  CardHeader,
  EmptyState,
  PageBand,
  StatCard,
  StatusBadge,
  formatMetric,
} from "@/components/ui";
import { AdminAnalytics } from "./admin-analytics";
import { ManagerOverview } from "./manager-overview";
import { PeriodComparisonTable } from "./period-comparison-table";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getAttentionRows,
  getAvailableWeeks,
  getLatestWeek,
  getTeamSummary,
} from "@/lib/queries/performance";
import { getOverdueCount, getSupervisorRollup } from "@/lib/queries/roster";
import { resolveScopedIds } from "@/lib/queries/performance";
import { getFactDateRange, getPeriodMetrics } from "@/lib/queries/period-metrics";
import { getTeamPeriodComparison } from "@/lib/queries/my-stats";
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
  const [params, weeks, latest, range, cookieStore] = await Promise.all([
    searchParams,
    getAvailableWeeks(),
    getLatestWeek(),
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
  const period =
    periods.find((p) => p.start === params.period) ??
    (!params.period
      ? periods.find((p) => p.start === cookieStore.get("periodStart")?.value)
      : undefined) ??
    periods[0] ??
    (latest ? periodContaining("week", latest) : null);

  // The attention table and issue counts stay weekly, since an action item
  // belongs to a week.
  const week = params.week && weeks.includes(params.week) ? params.week : latest;

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
  const periodUnmeasured = Math.max(0, summary.totalEmployees - periodMeasured);

  // Which KPIs actually had data. A boundary week can carry only attendance,
  // and reporting that as "nothing failing" reads as an all-clear when the
  // truth is that almost nothing was measured.
  const evaluatedKpis = [...new Set(weekMetrics.map((m) => m.kpiName))];
  // What the passing / at-risk / failing counts are actually built from.
  // Without naming these, "14 passing" reads as a clean bill of health when
  // it can mean one KPI had data and nobody failed it.
  const periodKpis = [...new Set(periodMetrics.map((m) => m.kpiName))].sort();

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
  const parTarget = parMetrics.find((m) => m.targetValue !== null)?.targetValue ?? null;
  const thinCoverage = weekMetrics.length > 0 && evaluatedKpis.length <= 2;

  // MBO is a composite gate rather than a threshold, so it is counted on its
  // own terms and links to the breakdown rather than the roster.
  const mboByEmployee = periodMetrics.filter((m) => m.kpiCode === "MBO");
  const mboPassing = mboByEmployee.filter((m) => m.actualValue >= 100).length;
  const mboFailing = mboByEmployee.length - mboPassing;
  const mboScored = mboByEmployee.length;
  const mboHref = (status: "pass" | "fail") =>
    `/mbo?granularity=${granularity}${period ? `&period=${period.start}` : ""}&status=${status}`;

  // Everyone with a linked employee record gets the comparison matrix. For an
  // agent it is a single row — their own KPIs against the previous period —
  // which is exactly the comparison the cards above cannot show.
  const showsComparison = scopedIds.length > 0;
  // Follows the period picker, so a week is compared against the previous
  // week rather than always against last month.
  const comparison =
    showsComparison && period ? await getTeamPeriodComparison(scopedIds, period) : null;

  const unscoped = !user.employeeEid && user.role !== "manager";

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
          <ManagerOverview managerName={user.managerName ?? user.name} period={period} />
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
          myKpis.length === 0 ? (
            <Card>
              <EmptyState
                title="No data for this period"
                description="Your KPIs appear here once performance data covering this period has been imported. Try a wider period."
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {myKpis.map((m) => (
                <StatCard
                  key={m.kpiCode}
                  label={m.kpiName}
                  value={formatMetric(m.actualValue, m.kpiCode)}
                  tone={
                    m.status === "FAIL" ? "fail" : m.status === "WARNING" ? "warn" : "pass"
                  }
                  hint={
                    m.targetValue === null
                      ? period?.label
                      : `target ${formatMetric(m.targetValue, m.kpiCode)} · ${m.sampleSize || 0} record${m.sampleSize === 1 ? "" : "s"}`
                  }
                />
              ))}
            </div>
          )
        ) : (
          <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={user.role === "agent" ? "Me" : "Employees"}
              value={summary.totalEmployees}
              hint={
                periodUnmeasured > 0
                  ? `${periodMeasured} with data · ${periodUnmeasured} without`
                  : period?.label
              }
            />
            <StatCard
              label="Passing PAR"
              value={parMetrics.length === 0 ? "—" : parPassing}
              tone={parMetrics.length === 0 ? "default" : "pass"}
              hint={
                parMetrics.length === 0
                  ? "No production rate scored this period"
                  : `of ${parMetrics.length} scored${parTarget === null ? "" : ` · target ${parTarget.toFixed(2)}`}`
              }
            />
            <StatCard label="At risk" value={periodAtRisk} tone="warn" hint={period?.label} />
            <StatCard
              label="Agents w/ Failing KPI"
              value={periodFailing}
              tone="fail"
              hint={period?.label}
            />
          </div>

          <p className="mt-3 text-xs text-muted">
            {periodKpis.length === 0
              ? "No KPI had data for this period, so nobody could be classified."
              : `Counted across ${periodKpis.length} KPI${periodKpis.length === 1 ? "" : "s"} with data this period: ${periodKpis.join(", ")}.`}
            {periodKpis.length === 1 &&
              " One KPI alone is not a full picture — try a wider period."}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Passing MBO"
              value={mboScored === 0 ? "—" : mboPassing}
              tone={mboScored === 0 ? "default" : "pass"}
              hint={
                mboScored === 0
                  ? "No MBO scored this period"
                  : `of ${mboScored} scored · ${period?.label ?? ""}`
              }
              href={mboHref("pass")}
            />
            <StatCard
              label="Failing MBO"
              value={mboScored === 0 ? "—" : mboFailing}
              tone={mboScored === 0 ? "default" : "fail"}
              hint={
                mboScored === 0
                  ? "Try a wider period"
                  : "See who and which gate they missed"
              }
              href={mboHref("fail")}
            />
          </div>
          </>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Active action items" value={summary.openIssues} href="/action-items" />
          <StatCard
            label="Awaiting acknowledgement"
            value={summary.awaitingAcknowledgement}
            tone="warn"
            href="/action-items"
          />
          <StatCard label="Monitoring" value={summary.monitoring} />
          <StatCard label="Sustained" value={summary.sustained} tone="pass" />
          <StatCard
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? "fail" : "default"}
            hint={overdue > 0 ? "Past the action plan due date" : undefined}
            href="/action-items"
          />
        </div>

        {showsRollup && rollup.length > 0 && (
          <Card className="mt-6">
            <CardHeader
              title="By supervisor"
              subtitle="Where the open work sits across your organization"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Supervisor</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">Team</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">
                      Failing this week
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-ink">
                      Open items
                    </th>
                    <th className="px-6 py-2.5 font-semibold text-ink">
                      Awaiting ack
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((row) => (
                    <tr
                      key={row.supervisorName}
                      className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100"
                    >
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees?supervisor=${encodeURIComponent(row.supervisorName)}${
                            week ? `&week=${week}` : ""
                          }`}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.supervisorName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-muted">
                        {row.teamSize}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono tabular-nums ${row.failingThisWeek > 0 ?"text-fail" : "text-muted"
                        }`}
                      >
                        {row.failingThisWeek || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-ink">
                        {row.openIssues || "—"}
                      </td>
                      <td
                        className={`px-6 py-2 font-mono tabular-nums ${row.awaitingAcknowledgement > 0 ?"text-warn" : "text-muted"
                        }`}
                      >
                        {row.awaitingAcknowledgement || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {comparison && <PeriodComparisonTable data={comparison} forSelf={isAgent} />}

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
