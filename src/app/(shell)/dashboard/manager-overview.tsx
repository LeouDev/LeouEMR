import { BarList, ChartFrame, StatusBar, TrendChart } from "@/components/charts";
import { Card, CardHeader, STATUS_LABELS, StatCard } from "@/components/ui";
import { getAnalytics, getMboOverview, type AnalyticsFilters } from "@/lib/queries/analytics";
import type { Period } from "@/lib/queries/period";
import { MboTree } from "./mbo-tree";

/**
 * A manager's org-wide overview, cut by supervisor.
 *
 * The same aggregates the administrator sees, scoped to this manager's span
 * and grouped by the level they actually manage — their supervisors — rather
 * than by site or by manager, neither of which varies inside one span.
 *
 * Unlike the administrator's view this sits above the operational tables
 * rather than replacing them: a manager still owns the action items below.
 */
export async function ManagerOverview({
  managerName,
  period,
}: {
  managerName: string;
  /** The reporting period selected above; the overview must follow it. */
  period: Period | null;
}) {
  // Weeks are keyed by their start date, so a month bounds the weeks whose
  // start falls inside it. Without these the overview would silently report
  // every week ever imported while the picker above said otherwise.
  const filters: AnalyticsFilters = {
    manager: managerName,
    weekFrom: period?.start,
    weekTo: period?.end,
  };

  const [analytics, mbo] = await Promise.all([getAnalytics(filters), getMboOverview(filters)]);

  if (analytics.totalEmployees === 0) {
    return (
      <Card className="mb-6">
        <CardHeader
          title="Organization overview"
          subtitle="No employees are linked to your span"
        />
        <p className="px-6 py-8 text-center text-sm text-muted">
          Your account is not linked to a manager name in the imported data, so there is nothing to
          summarise. An administrator can set that link on the Users page.
        </p>
      </Card>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
            Organization overview
          </h2>
          <p className="mt-1 text-sm text-muted">
            Your whole span, cut by supervisor
            {period ? ` · ${period.label}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="With data"
          value={analytics.employeesWithData}
          hint={`of ${analytics.totalEmployees} in my span`}
        />
        <StatCard
          label="MBO pass rate"
          value={mbo.passRate === null ? "—" : `${mbo.passRate.toFixed(1)}%`}
          tone={mbo.passRate !== null && mbo.passRate >= 90 ? "pass" : "warn"}
          hint={`${mbo.passing} of ${mbo.scored} clearing every gate`}
        />
        <StatCard
          label="Failing latest week"
          value={analytics.failingEmployees}
          tone={analytics.failingEmployees > 0 ? "fail" : "pass"}
          hint={analytics.asOfLabel ? `${analytics.asOfLabel} · any KPI, not just MBO` : "No week in range"}
        />
        <StatCard
          label="Open action items"
          value={analytics.openIssues}
          hint={period?.label}
          href="/action-items"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <ChartFrame
            title="Fail rate by week"
            subtitle="Share of your people failing at least one KPI"
          >
            <TrendChart points={analytics.trend} />
          </ChartFrame>
        </div>

        <ChartFrame
          title="Fail rate by supervisor"
          subtitle={
            analytics.asOfLabel
              ? `Week of ${analytics.asOfLabel} — any KPI, not just MBO`
              : "Latest week in range"
          }
        >
          <BarList
            rows={analytics.bySupervisor.map((s) => ({
              label: s.label,
              value: s.failRate,
              caption: `${s.employees} employees · ${s.openIssues} open items`,
            }))}
            emptyMessage="No supervisors recorded in your span."
          />
        </ChartFrame>

        <ChartFrame title="Fail rate by KPI" subtitle={period?.label ?? "All weeks"}>
          <BarList
            rows={analytics.kpis.map((k) => ({
              label: k.name,
              value: k.failRate,
              caption: `${k.failing} of ${k.total} weekly results`,
            }))}
          />
        </ChartFrame>

        <div className="lg:col-span-2">
          <ChartFrame
            title="Action items by status"
            subtitle={`Opened in ${period?.label ?? "range"}`}
          >
            <StatusBar
              rows={analytics.statuses.map((s) => ({
                ...s,
                label: STATUS_LABELS[s.status] ?? s.status,
              }))}
            />
          </ChartFrame>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="MBO attainment"
          subtitle="Your span by site, then supervisor, then agent"
        />
        <MboTree sites={mbo.sites} />
      </Card>
    </section>
  );
}
