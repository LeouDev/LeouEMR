import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartFrame, BarList, GroupedBarChart, MultiSeriesTrendChart } from "@/components/charts";
import { Card, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getMboOverview, type MboNode } from "@/lib/queries/analytics";
import { getCriticalErrorsTrendBySupervisor } from "@/lib/queries/critical-errors-trend";
import { getMboAttainmentBySkill } from "@/lib/queries/mbo-by-skill";
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  parseGranularity,
  periodsBetween,
  type Granularity,
  type Period,
} from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import {
  ahtChartRows,
  cphChartRows,
  getSkillMetricsBySupervisor,
  type SkillSupervisorRow,
} from "@/lib/queries/skill-supervisor-breakdown";

/** How many trailing buckets the Critical IO trend plots, ending at the selected period. */
const TREND_BUCKETS = 12;

/** Every manager appearing under any site, merged the way a supervisor already is under a manager. */
function flattenByLabel(nodes: MboNode[]): Array<{ label: string; scored: number; passing: number }> {
  const byLabel = new Map<string, { scored: number; passing: number }>();
  for (const node of nodes) {
    const entry = byLabel.get(node.label) ?? { scored: 0, passing: 0 };
    entry.scored += node.scored;
    entry.passing += node.passing;
    byLabel.set(node.label, entry);
  }
  return [...byLabel.entries()].map(([label, e]) => ({ label, ...e }));
}

function passRateRows(entries: Array<{ label: string; scored: number; passing: number }>) {
  return entries
    .filter((e) => e.scored > 0)
    .map((e) => ({
      label: e.label,
      value: (e.passing / e.scored) * 100,
      caption: `${e.passing} of ${e.scored} clearing every gate`,
    }))
    .sort((a, b) => b.value - a.value);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // This replaces the Employees tab in the admin nav specifically — a
  // leader tool for everyone else, so there is nothing for another role to
  // land on here.
  if (user.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const granularity: Granularity = parseGranularity(params.granularity ?? "month");

  const range = await getFactDateRange();
  if (!range) {
    return (
      <>
        <PageBand title="Analytics" subtitle="Org-wide attainment and throughput" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <p className="px-6 py-8 text-center text-sm text-muted">
              Nothing has been imported yet — this view populates once performance data is in.
            </p>
          </Card>
        </main>
      </>
    );
  }

  const periods = periodsBetween(granularity, range.first, range.last);
  const selectedStart = params.period;
  const periodIndex = Math.max(
    0,
    selectedStart ? periods.findIndex((p) => p.start === selectedStart) : 0,
  );
  const period: Period = periods[periodIndex] ?? periods[0];

  // periods is newest-first; the trend wants the trailing window ending at
  // the selected one, oldest first, the way a chart reads left to right.
  const trendBuckets = periods
    .slice(periodIndex, periodIndex + TREND_BUCKETS)
    .slice()
    .reverse();

  const [mbo, skillMetrics, skillAttainment, criticalTrend] = await Promise.all([
    getMboOverview({ weekFrom: period.start, weekTo: period.end }),
    getSkillMetricsBySupervisor(period),
    getMboAttainmentBySkill(period),
    getCriticalErrorsTrendBySupervisor(trendBuckets),
  ]);

  const managers = flattenByLabel(mbo.sites.flatMap((s) => s.children));
  const sites = flattenByLabel(mbo.sites);

  const skillAttainmentRows = skillAttainment
    .filter((s) => s.scored > 0)
    .map((s) => ({
      label: s.skillName,
      value: s.passRate,
      caption: `${s.passing} of ${s.scored} meeting target`,
    }))
    .sort((a, b) => b.value - a.value);

  const supervisors = [...new Set(skillMetrics.map((r) => r.supervisor))].sort();
  const cphRows = cphChartRows(skillMetrics);
  const ahtRows = ahtChartRows(skillMetrics);
  const cphSkillKeys = [...new Map(cphRows.map((r) => [r.skillCode, r.skillName])).entries()];
  const ahtSkillKeys = [...new Map(ahtRows.map((r) => [r.skillCode, r.skillName])).entries()];
  const groupsFor = (rows: SkillSupervisorRow[], metric: "cph" | "aht") =>
    supervisors.map((supervisor) => ({
      label: supervisor,
      values: Object.fromEntries(
        rows.filter((r) => r.supervisor === supervisor).map((r) => [r.skillCode, r[metric]]),
      ),
    }));

  const trendSupervisors = [...new Set(criticalTrend.flatMap((b) => Object.keys(b.bySupervisor)))];
  const trendSeries = trendSupervisors.map((name) => ({
    key: name,
    label: name,
    values: criticalTrend.map((b) => b.bySupervisor[name] ?? null),
    total: criticalTrend.reduce((sum, b) => sum + (b.bySupervisor[name] ?? 0), 0),
  }));
  const bucketLabels = trendBuckets.map((p) => p.label);

  const select = "border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none";

  return (
    <>
      <PageBand title="Analytics" subtitle={`${period.label} · org-wide`} />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <form method="get" className="mb-6 border-2 border-ink bg-surface p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                View by
              </span>
              <select name="granularity" defaultValue={granularity} className={select}>
                {GRANULARITIES.map((g) => (
                  <option key={g} value={g}>
                    {GRANULARITY_LABELS[g]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Period
              </span>
              <select name="period" defaultValue={period.start} className={select}>
                {periods.map((p) => (
                  <option key={p.start} value={p.start}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="btn-primary px-5 py-2.5 text-sm">
              Apply
            </button>

            {(params.granularity || params.period) && (
              <Link
                href="/analytics"
                className="border-2 border-ink px-5 py-2.5 text-sm font-bold text-ink transition hover:bg-orange-brand-100"
              >
                Reset
              </Link>
            )}
          </div>
        </form>

        <div className="grid gap-4 lg:grid-cols-3">
          <ChartFrame title="MBO attainment by manager" subtitle={period.label}>
            <BarList rows={passRateRows(managers)} tone="better-when-higher" emptyMessage="No MBO data this period." />
          </ChartFrame>

          <ChartFrame title="MBO attainment by site" subtitle={period.label}>
            <BarList rows={passRateRows(sites)} tone="better-when-higher" emptyMessage="No MBO data this period." />
          </ChartFrame>

          <ChartFrame title="MBO attainment by skill" subtitle={`${period.label} · share hitting each skill's own target`}>
            <BarList rows={skillAttainmentRows} tone="better-when-higher" emptyMessage="No skill data this period." />
          </ChartFrame>
        </div>

        <div className="mt-4 grid gap-4">
          <ChartFrame
            title="Cases per hour, every skill, by supervisor"
            subtitle={`${period.label} · includes skills scored on case rate; excludes those scored on average handle time · scale capped at 30/hr, an outlier bar's own label still shows its real figure`}
          >
            <GroupedBarChart
              groups={groupsFor(cphRows, "cph")}
              series={cphSkillKeys.map(([code, name]) => ({ key: code, label: name }))}
              unit="/hr"
              maxValue={30}
              emptyMessage="No production data this period."
            />
          </ChartFrame>

          <ChartFrame
            title="Average handle time, every skill, by supervisor"
            subtitle={`${period.label} · seconds per case · excludes skills scored on cases per hour or case rate`}
          >
            <GroupedBarChart
              groups={groupsFor(ahtRows, "aht")}
              series={ahtSkillKeys.map(([code, name]) => ({ key: code, label: name }))}
              unit="s"
              decimals={0}
              emptyMessage="No production data this period."
            />
          </ChartFrame>

          <ChartFrame
            title="Critical errors trend by supervisor"
            subtitle={`Last ${bucketLabels.length} ${GRANULARITY_LABELS[granularity].toLowerCase()}${bucketLabels.length === 1 ? "" : "s"}, ending ${period.label}`}
          >
            <MultiSeriesTrendChart buckets={bucketLabels} series={trendSeries} />
          </ChartFrame>
        </div>

        <p className="mt-4 text-xs text-muted">
          This view is read-only and org-wide, with no site or manager filter — for a filtered breakdown,
          use the Dashboard tab.
        </p>
      </main>
    </>
  );
}
