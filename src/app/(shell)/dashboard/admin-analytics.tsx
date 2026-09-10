import Link from "next/link";
import { BarList, ChartFrame, StatusBar, TrendChart } from "@/components/charts";
import { Card, CardHeader, STATUS_LABELS, StatCard } from "@/components/ui";
import {
  getAnalytics,
  getAnalyticsFacets,
  getMboOverview,
  type AnalyticsFilters,
  type TrendGrain,
} from "@/lib/queries/analytics";
import { MboTree } from "./mbo-tree";
import { TrendToggle } from "./trend-toggle";

/**
 * The administrator's view: a read-only, org-wide report.
 *
 * An administrator governs the system rather than working individual cases,
 * so this deliberately offers no editing — only aggregate figures and the
 * filters needed to narrow them. The per-employee tables live on the
 * supervisor and manager dashboards, where someone can actually act on a row.
 */
export async function AdminAnalytics({
  filters,
  weeks,
  isDefaultRange,
}: {
  filters: AnalyticsFilters;
  weeks: string[];
  /** True when weekFrom/weekTo came from the default trailing-3-months window, not an explicit choice. */
  isDefaultRange: boolean;
}) {
  const grain: TrendGrain = filters.grain === "month" ? "month" : "week";
  const bounds = { first: weeks[weeks.length - 1], last: weeks[0] };
  // Requested together. getAnalytics and getMboOverview are cached reads
  // whose cold computations are serialised through a shared queue (see
  // src/lib/cache.ts): each fans out 4-6 queries internally, and running
  // two of those together used to spike past the db client's pool
  // (max: 8 in src/lib/db/client.ts) and wedge a connection against
  // Supabase's transaction-mode pooler — the reason this was three awaits
  // in a row. The queue keeps that guarantee; the cache removes the wait
  // on the admin's default landing page.
  const [analytics, mbo, facets] = await Promise.all([
    getAnalytics(filters),
    getMboOverview(filters),
    getAnalyticsFacets(),
  ]);

  const filtered = Boolean(filters.site || filters.manager || filters.grain || !isDefaultRange);
  // What the "by site/manager" boards and "failing latest ___" describe — a
  // single week under the week grain, the whole latest month under the month
  // grain. Deriving this from the trend chart's last bucket used to work only
  // by accident: a month bucket's key is a month-start, and formatting that
  // as a week fabricated a false 7-day range next to figures that actually
  // covered the whole month.
  const asOfLabel = analytics.asOfLabel;
  // Every figure on this page now moves with the range, so say what it is.
  const rangeLabel =
    filters.weekFrom || filters.weekTo
      ? `${filters.weekFrom ?? "earliest"} to ${filters.weekTo ?? "latest"}`
      : "all weeks";

  const select = "border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none";

  // Preserves site/manager/grain, drops any date range, and explicitly
  // requests the unbounded view — a deliberate opt-in, not a default,
  // since it costs a full scan of every fact table to compute.
  const allTimeParams = new URLSearchParams();
  if (filters.site) allTimeParams.set("site", filters.site);
  if (filters.manager) allTimeParams.set("manager", filters.manager);
  if (filters.grain) allTimeParams.set("grain", filters.grain);
  allTimeParams.set("span", "all");
  const allTimeHref = `/dashboard?${allTimeParams.toString()}`;

  return (
    <>
      {/* View-only filters. A GET form keeps every view a shareable URL and
          means nothing on this page can mutate data. */}
      <form method="get" className="mb-6 border-2 border-ink bg-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Site
            </span>
            <select name="site" defaultValue={filters.site ?? ""} className={select}>
              <option value="">All sites</option>
              {facets.sites.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Manager
            </span>
            <select name="manager" defaultValue={filters.manager ?? ""} className={select}>
              <option value="">All managers</option>
              {facets.managers.map((manager) => (
                <option key={manager} value={manager}>
                  {manager}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              From date
            </span>
            <input
              type="date"
              name="weekFrom"
              defaultValue={filters.weekFrom ?? ""}
              min={bounds.first}
              max={bounds.last}
              className={select}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              To date
            </span>
            <input
              type="date"
              name="weekTo"
              defaultValue={filters.weekTo ?? ""}
              min={bounds.first}
              max={bounds.last}
              className={select}
            />
          </label>

          <fieldset className="block">
            <legend className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Trend by
            </legend>
            <TrendToggle grain={grain} />
          </fieldset>

          <button
            type="submit"
            className="btn-primary px-5 py-2.5 text-sm"
          >
          Apply
        </button>

          {filtered && (
            <Link
              href="/dashboard"
              className="border-2 border-ink px-5 py-2.5 text-sm font-bold text-ink transition hover:bg-orange-brand-100"
            >
              Reset
            </Link>
          )}

          {(filters.weekFrom || filters.weekTo) && (
            <Link
              href={allTimeHref}
              className="px-3 py-2.5 text-sm font-medium text-muted underline-offset-4 transition hover:text-orange-brand hover:underline"
              title="Scans every imported week — slower than the default 3-month view"
            >
              View all-time
            </Link>
          )}
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Employees with data"
          value={analytics.employeesWithData}
          hint={
            analytics.employeesWithData === analytics.totalEmployees
              ? rangeLabel
              : `of ${analytics.totalEmployees} in scope · ${rangeLabel}`
          }
        />
        <StatCard
          label="MBO pass rate"
          value={mbo.passRate === null ? "—" : `${mbo.passRate.toFixed(1)}%`}
          tone={mbo.passRate !== null && mbo.passRate >= 90 ? "pass" : "warn"}
          hint={`${mbo.passing} of ${mbo.scored} clearing every gate`}
        />
        <StatCard
          label={grain === "month" ? "Failing latest month" : "Failing latest week"}
          value={analytics.failingEmployees}
          tone={analytics.failingEmployees > 0 ? "fail" : "pass"}
          hint={asOfLabel ? `${asOfLabel} · any KPI, not just MBO` : undefined}
        />
        <StatCard
          label="Open action items"
          value={analytics.openIssues}
          hint={rangeLabel}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <ChartFrame
            title={grain === "month" ? "Fail rate by month" : "Fail rate by week"}
            subtitle="Share of evaluated employees failing at least one KPI"
          >
            <TrendChart points={analytics.trend} grain={grain} />
          </ChartFrame>
        </div>

        <ChartFrame title="Fail rate by KPI" subtitle={`Across ${rangeLabel}`}>
          <BarList
            rows={analytics.kpis.map((k) => ({
              label: k.name,
              value: k.failRate,
              caption: `${k.failing} of ${k.total} weekly results`,
            }))}
          />
        </ChartFrame>

        <ChartFrame title="Action items by status" subtitle={`Items opened ${rangeLabel}`}>
          <StatusBar
            rows={analytics.statuses.map((s) => ({
              ...s,
              label: STATUS_LABELS[s.status] ?? s.status,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Fail rate by site"
          subtitle={`${asOfLabel ?? (grain === "month" ? "Latest month" : "Latest week")} — any KPI, not just MBO`}
        >
          <BarList
            rows={analytics.bySite.map((s) => ({
              label: s.label,
              value: s.failRate,
              caption: `${s.employees} employees · ${s.openIssues} open items`,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Fail rate by manager"
          subtitle={`${asOfLabel ?? (grain === "month" ? "Latest month" : "Latest week")} — any KPI, not just MBO`}
        >
          <BarList
            rows={analytics.byManager.slice(0, 12).map((m) => ({
              label: m.label,
              value: m.failRate,
              caption: `${m.employees} employees · ${m.openIssues} open items`,
            }))}
          />
        </ChartFrame>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="MBO attainment by site"
          subtitle="Expand a site to see its managers, then a manager to see supervisors and their agents"
        />
        <MboTree sites={mbo.sites} />
      </Card>

      <p className="mt-4 text-xs text-muted">
        This view is read-only. Employee records, targets and action items are edited by the manager
        or supervisor who owns them.
      </p>
    </>
  );
}
