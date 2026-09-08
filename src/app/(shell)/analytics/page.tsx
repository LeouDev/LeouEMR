import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AnalyticsScene } from "@/components/analytics-scene";
import { ChartFrame, TrendBarChart, TrendLineChart } from "@/components/charts";
import { Card, EmptyState, PageBand } from "@/components/ui";
import {
  ANALYTICS_TARGETS,
  getAnalytics,
  getMboOverview,
  type AnalyticsSnapshot,
  type MboNode,
  type MboOverview,
} from "@/lib/queries/analytics";
import { getCriticalErrorsTrendBySupervisor } from "@/lib/queries/critical-errors-trend";
import { getCurrentUser } from "@/lib/auth/session";
import { getEwsRiskCounts } from "@/lib/queries/ews";
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
import { GranularitySelect } from "./granularity-select";

/**
 * How many trailing buckets the org-wide trends plot, ending at the
 * selected period.
 *
 * Kept modest deliberately: each bucket needs its own `getMboOverview` call,
 * and that query rebuilds the whole site → manager → supervisor → employee
 * tree from scratch — it is not cheap to run a dozen of. `fetchMboTrend`
 * below also reuses the current and prior period's own calls rather than
 * re-fetching them a second time as trend buckets.
 */
const TREND_BUCKETS = 6;

/** Caps how many `getMboOverview` calls run at once for the trend buckets, so this page's own fan-out stays well inside the db client's pool (`src/lib/db/client.ts`), which is sized for the app's other pages. */
const TREND_FETCH_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Tone = "pass" | "warn" | "fail" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  pass: "text-pass",
  warn: "text-warn",
  fail: "text-fail",
  muted: "text-muted",
};
const TONE_BAR: Record<Tone, string> = {
  pass: "bg-pass",
  warn: "bg-warn",
  fail: "bg-fail",
  muted: "bg-ink-faint",
};

/** `±1.2 pt`-style delta, the sign read from the raw difference. */
function fmtDelta(d: number, unit = "", decimals = 1): string {
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return `${sign}${Math.abs(d).toFixed(decimals)}${unit}`;
}

/** Green when the change moves the right direction, red the other way, muted when unchanged. */
function deltaTone(d: number, higherIsBetter: boolean): Tone {
  if (d === 0) return "muted";
  return (d > 0) === higherIsBetter ? "pass" : "fail";
}

/**
 * pass when on target; warn within 7% (higher-is-better) or 25%
 * (lower-is-better) of it; fail otherwise. Executive-report tone, not a
 * KPI's own scored pass/fail — see ANALYTICS_TARGETS's own note.
 */
function kpiTone(value: number, target: number, higherIsBetter: boolean): Tone {
  const onTarget = higherIsBetter ? value >= target : value <= target;
  if (onTarget) return "pass";
  const near = higherIsBetter ? value >= target * 0.93 : value <= target * 1.25;
  return near ? "warn" : "fail";
}

/** Site -> manager -> supervisor, flattened with the tree context each leaf needs. */
function flattenSupervisors(mbo: MboOverview): Array<{ node: MboNode; manager: string; site: string }> {
  const out: Array<{ node: MboNode; manager: string; site: string }> = [];
  for (const site of mbo.sites) {
    for (const manager of site.children) {
      for (const supervisor of manager.children) {
        out.push({ node: supervisor, manager: manager.label, site: site.label });
      }
    }
  }
  return out;
}

/** Cases-weighted average of one metric across whatever rows are handed in. */
function weightedAverageRows(rows: SkillSupervisorRow[], metric: "cph" | "aht"): number | null {
  const relevant = rows.filter((r) => r[metric] !== null && r.cases > 0);
  const totalCases = relevant.reduce((sum, r) => sum + r.cases, 0);
  if (totalCases === 0) return null;
  const weighted = relevant.reduce((sum, r) => sum + r[metric]! * r.cases, 0);
  return weighted / totalCases;
}

/** Cases-weighted average of one metric across a single supervisor's own rows for it. */
function weightedAverage(rows: SkillSupervisorRow[], supervisor: string, metric: "cph" | "aht"): number | null {
  return weightedAverageRows(
    rows.filter((r) => r.supervisor === supervisor),
    metric,
  );
}

/** Groups rows by the site their supervisor belongs to, dropping rows for a supervisor with no known site. */
function bucketRowsBySite(rows: SkillSupervisorRow[], siteOf: (supervisor: string) => string | undefined) {
  const out = new Map<string, SkillSupervisorRow[]>();
  for (const row of rows) {
    const site = siteOf(row.supervisor);
    if (!site) continue;
    const bucket = out.get(site);
    if (bucket) bucket.push(row);
    else out.set(site, [row]);
  }
  return out;
}

/** Builds a `?a=x&b=y` string from the current search params with the given overrides applied. */
function withParams(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const merged: Record<string, string | undefined> = { ...base, ...overrides };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "teams", label: "Teams" },
  { key: "risks", label: "Risks" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SORTS = [
  { key: "pass", label: "Lowest pass rate first" },
  { key: "open", label: "Most open items first" },
  { key: "site", label: "By site" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

/** The four headline KPI cards, built once and shared between rendering and nothing else — kept together so the tone/delta/bar math for all four stays in one place. */
interface Kpi {
  label: string;
  value: number | null;
  prior: number | null;
  target: number;
  higherIsBetter: boolean;
  unit: string;
  decimals: number;
  hint: string;
  axisMax: number;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const tone: Tone = kpi.value === null ? "muted" : kpiTone(kpi.value, kpi.target, kpi.higherIsBetter);
  const displayValue = kpi.value === null ? "—" : `${kpi.value.toFixed(kpi.decimals)}${kpi.unit}`;
  const delta = kpi.value !== null && kpi.prior !== null ? kpi.value - kpi.prior : null;
  const barPct = kpi.value === null ? 0 : Math.min(100, Math.max(0, (kpi.value / kpi.axisMax) * 100));
  const targetPct = Math.min(100, Math.max(0, (kpi.target / kpi.axisMax) * 100));

  return (
    <div className="flex flex-col gap-3 border-2 border-ink bg-surface px-5 pt-[18px] pb-4">
      <div className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">{kpi.label}</div>
      <div className={`text-[40px] leading-none font-extrabold tracking-[-0.02em] tabular-nums ${TONE_TEXT[tone]}`}>
        {displayValue}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs font-semibold text-muted">
        {delta !== null && (
          <span className={`whitespace-nowrap ${TONE_TEXT[deltaTone(delta, kpi.higherIsBetter)]}`}>
            {fmtDelta(delta, kpi.unit, kpi.decimals)} vs prior
          </span>
        )}
        <span className="whitespace-nowrap">
          Target {kpi.higherIsBetter ? "" : "≤ "}
          {kpi.target}
          {kpi.unit}
        </span>
      </div>
      <div className="relative h-1.5 bg-line">
        <div className={`absolute inset-y-0 left-0 ${TONE_BAR[tone]}`} style={{ width: `${barPct}%` }} />
        <div className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-ink" style={{ left: `${targetPct}%` }} />
      </div>
      <div className="text-xs text-muted">{kpi.hint}</div>
    </div>
  );
}

/** A ChartFrame with the real title already in place and a pulsing placeholder body — the Suspense fallback for a chart whose data is still on its way. */
function ChartSkeleton({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <div className="h-48 w-full animate-pulse bg-line motion-reduce:animate-none" />
    </ChartFrame>
  );
}

/**
 * The one piece of the Overview tab that needs MBO history beyond the
 * current and prior period. Rendered inside its own Suspense boundary so
 * fetching several more trailing `getMboOverview` calls — the single most
 * expensive query on this page — never blocks the KPI cards or the rest of
 * the tab from showing up first.
 */
async function MboTrendChart({
  trendBuckets,
  mboCurrent,
  mboPrior,
  periodNoun,
}: {
  trendBuckets: Period[];
  mboCurrent: MboOverview;
  mboPrior: MboOverview | null;
  periodNoun: string;
}) {
  const olderBuckets = trendBuckets.slice(0, Math.max(0, trendBuckets.length - 2));
  const olderMbo =
    olderBuckets.length > 0
      ? await mapWithConcurrency(olderBuckets, TREND_FETCH_CONCURRENCY, (b) =>
          getMboOverview({ weekFrom: b.start, weekTo: b.end }),
        )
      : [];
  const mboTrend: MboOverview[] = [...olderMbo, ...(mboPrior ? [mboPrior] : []), mboCurrent];

  return (
    <ChartFrame
      title={`MBO pass rate, trailing ${mboTrend.length} ${periodNoun}${mboTrend.length === 1 ? "" : "s"}`}
      subtitle="Share of scored people clearing every gate"
    >
      <TrendLineChart
        buckets={trendBuckets.map((p) => p.label)}
        values={mboTrend.map((m) => m.passRate)}
        selectedIndex={mboTrend.length - 1}
        target={ANALYTICS_TARGETS.passRate}
        unit="%"
        decimals={0}
      />
    </ChartFrame>
  );
}

interface Signal {
  title: string;
  who: string;
  level: "High" | "Medium" | "Low";
}

const SIGNAL_TONE: Record<Signal["level"], { dot: string; bg: string; fg: string }> = {
  High: { dot: "bg-fail", bg: "bg-fail-bg", fg: "text-fail" },
  Medium: { dot: "bg-warn", bg: "bg-warn-bg", fg: "text-warn" },
  Low: { dot: "bg-ink-faint", bg: "bg-line", fg: "text-muted" },
};

/**
 * The Risks tab's derived signals — the same Suspense isolation as
 * MboTrendChart, and for the same reason: only the first signal below
 * needs MBO history beyond current/prior, but keeping all five together
 * means they stream in already sorted by priority rather than popping in
 * one at a time out of order.
 */
async function EarlyWarningSignalsCard({
  trendBuckets,
  mboCurrent,
  mboPrior,
  priorPeriod,
  analyticsCurrent,
  analyticsPrior,
  criticalBySupervisorCurrent,
  criticalErrorsCurrent,
  supervisorSite,
  skillMetrics,
  skillMetricsPrior,
  periodNoun,
}: {
  trendBuckets: Period[];
  mboCurrent: MboOverview;
  mboPrior: MboOverview | null;
  priorPeriod: Period | null;
  analyticsCurrent: AnalyticsSnapshot;
  analyticsPrior: AnalyticsSnapshot | null;
  criticalBySupervisorCurrent: Record<string, number>;
  criticalErrorsCurrent: number;
  supervisorSite: Map<string, string>;
  skillMetrics: SkillSupervisorRow[];
  skillMetricsPrior: SkillSupervisorRow[];
  periodNoun: string;
}) {
  const olderBuckets = trendBuckets.slice(0, Math.max(0, trendBuckets.length - 2));
  const olderMbo =
    olderBuckets.length > 0
      ? await mapWithConcurrency(olderBuckets, TREND_FETCH_CONCURRENCY, (b) =>
          getMboOverview({ weekFrom: b.start, weekTo: b.end }),
        )
      : [];
  const mboTrend: MboOverview[] = [...olderMbo, ...(mboPrior ? [mboPrior] : []), mboCurrent];

  const critBySup = Object.entries(criticalBySupervisorCurrent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  const signals: Signal[] = [];

  // Pass rate down 3 consecutive buckets.
  if (mboTrend.length >= 4) {
    for (const { node, site } of flattenSupervisors(mboCurrent)) {
      const series = mboTrend
        .slice(-4)
        .map((m) => flattenSupervisors(m).find((s) => s.node.label === node.label)?.node.passRate ?? null);
      if (series.some((v) => v === null)) continue;
      const [a, b, c, d] = series as number[];
      if (a > b && b > c && c > d) {
        signals.push({
          title: "Pass rate down 3 consecutive periods",
          who: `${node.label} · ${site} · ${a.toFixed(0)}% → ${d.toFixed(0)}%`,
          level: "High",
        });
        break;
      }
    }
  }

  // Two supervisors carrying half or more of critical errors.
  if (criticalErrorsCurrent > 0 && critBySup.length >= 2) {
    const topTwo = critBySup[0].count + critBySup[1].count;
    if (topTwo / criticalErrorsCurrent >= 0.5) {
      signals.push({
        title: "Critical errors concentrated in two teams",
        who: `${critBySup[0].name} and ${critBySup[1].name} carry ${topTwo} of ${criticalErrorsCurrent} org-wide`,
        level: "High",
      });
    }
  }

  // Any team with more than 25 open items.
  const overloaded = analyticsCurrent.bySupervisor.filter((r) => r.openIssues > 25);
  if (overloaded.length > 0) {
    signals.push({
      title: "Open action items above 25 per team",
      who: overloaded.map((r) => `${r.label} (${r.openIssues})`).join(", "),
      level: "Medium",
    });
  }

  // Site AHT trending up vs the prior period — a genuine cases-weighted
  // aggregate across every AHT-scored row for that site's supervisors, not
  // a mean of already-averaged per-supervisor figures.
  if (priorPeriod && skillMetricsPrior.length > 0) {
    const priorSupervisorSite = new Map(flattenSupervisors(mboPrior ?? mboCurrent).map(({ node, site }) => [node.label, site]));
    const currentBySite = bucketRowsBySite(ahtChartRows(skillMetrics), (s) => supervisorSite.get(s));
    const priorBySite = bucketRowsBySite(ahtChartRows(skillMetricsPrior), (s) => priorSupervisorSite.get(s));
    for (const [site, rows] of currentBySite) {
      const currentAht = weightedAverageRows(rows, "aht");
      const priorRows = priorBySite.get(site);
      const priorAht = priorRows ? weightedAverageRows(priorRows, "aht") : null;
      if (currentAht !== null && priorAht !== null && currentAht > priorAht) {
        signals.push({
          title: "AHT trending up vs the prior period",
          who: `${site} site · +${Math.round(currentAht - priorAht)}s vs ${priorPeriod.label}`,
          level: "Medium",
        });
        break;
      }
    }
  }

  // Attendance-gate fail share rising, org-wide (no per-site KPI breakdown exists to be more specific).
  const attendanceCurrent = analyticsCurrent.kpis.find((k) => k.code === "ATTENDANCE");
  const attendancePrior = analyticsPrior?.kpis.find((k) => k.code === "ATTENDANCE");
  if (attendanceCurrent && attendancePrior && attendanceCurrent.failRate > attendancePrior.failRate) {
    signals.push({
      title: "Attendance gate misses rising",
      who: `Org-wide · ${attendancePrior.failRate.toFixed(1)}% → ${attendanceCurrent.failRate.toFixed(1)}%`,
      level: "Low",
    });
  }

  const shownSignals = signals.slice(0, 5);

  return (
    <ChartFrame title="Early warning signals" subtitle={`Patterns that need a decision this ${periodNoun}`}>
      {shownSignals.length === 0 ? (
        <EmptyState title="Nothing flagged" description="No signal pattern is met this period." />
      ) : (
        <div>
          {shownSignals.map((g, i) => {
            const tone = SIGNAL_TONE[g.level];
            return (
              <div key={i} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-3.5 border-b-2 border-line py-3.5 last:border-0">
                <span className={`h-3 w-3 ${tone.dot}`} />
                <div>
                  <div className="text-sm font-bold text-ink">{g.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{g.who}</div>
                </div>
                <span className={`whitespace-nowrap px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] uppercase ${tone.bg} ${tone.fg}`}>
                  {g.level}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; sort?: string; granularity?: string; period?: string }>;
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
  const tab: Tab = params.tab === "teams" ? "teams" : params.tab === "risks" ? "risks" : "overview";
  const sort: Sort = params.sort === "open" ? "open" : params.sort === "site" ? "site" : "pass";

  const range = await getFactDateRange();
  if (!range) {
    return (
      <>
        <PageBand title="Analytics" subtitle="Org-wide executive report" />
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
  const periodIndex = Math.max(0, selectedStart ? periods.findIndex((p) => p.start === selectedStart) : 0);
  const period: Period = periods[periodIndex] ?? periods[0];
  // periods is newest-first: a higher index is further into the past.
  const priorPeriod: Period | null = periods[periodIndex + 1] ?? null;
  const nextPeriod: Period | null = periods[periodIndex - 1] ?? null;
  const periodNoun = GRANULARITY_LABELS[granularity].toLowerCase();

  // Oldest first, ending at the selected period — the way every trend here reads left to right.
  const trendBuckets = periods
    .slice(periodIndex, periodIndex + TREND_BUCKETS)
    .slice()
    .reverse();

  const [mboCurrent, mboPrior, analyticsCurrent, analyticsPrior, skillMetrics, skillMetricsPrior, criticalTrend, ewsCurrent, ewsPrior] =
    await Promise.all([
      getMboOverview({ weekFrom: period.start, weekTo: period.end }),
      priorPeriod
        ? getMboOverview({ weekFrom: priorPeriod.start, weekTo: priorPeriod.end })
        : Promise.resolve<MboOverview | null>(null),
      getAnalytics({ weekFrom: period.start, weekTo: period.end }),
      priorPeriod
        ? getAnalytics({ weekFrom: priorPeriod.start, weekTo: priorPeriod.end })
        : Promise.resolve<AnalyticsSnapshot | null>(null),
      getSkillMetricsBySupervisor(period),
      priorPeriod ? getSkillMetricsBySupervisor(priorPeriod) : Promise.resolve<SkillSupervisorRow[]>([]),
      getCriticalErrorsTrendBySupervisor(trendBuckets),
      getEwsRiskCounts(period),
      priorPeriod ? getEwsRiskCounts(priorPeriod) : Promise.resolve(null),
    ]);

  // The trend line (Overview) and the early-warning signals (Risks) are the
  // only things that need MBO history beyond the current and prior period —
  // each fetches its own older buckets lazily, inside its own component
  // below, so the Teams tab never pays for it and the rest of whichever tab
  // does need it renders without waiting on it. See `MboTrendChart` and
  // `EarlyWarningSignalsCard`.

  const criticalBySupervisorCurrent = criticalTrend[criticalTrend.length - 1]?.bySupervisor ?? {};
  const criticalBySupervisorPrior =
    priorPeriod && criticalTrend.length >= 2 ? (criticalTrend[criticalTrend.length - 2]?.bySupervisor ?? {}) : null;
  const criticalErrorsCurrent = Object.values(criticalBySupervisorCurrent).reduce((a, b) => a + b, 0);
  const criticalErrorsPrior = criticalBySupervisorPrior
    ? Object.values(criticalBySupervisorPrior).reduce((a, b) => a + b, 0)
    : null;

  const supervisorSite = new Map(flattenSupervisors(mboCurrent).map(({ node, site }) => [node.label, site]));

  const kpis: Kpi[] = [
    {
      label: "MBO pass rate",
      value: mboCurrent.passRate,
      prior: mboPrior?.passRate ?? null,
      target: ANALYTICS_TARGETS.passRate,
      higherIsBetter: true,
      unit: "%",
      decimals: 1,
      hint: `${mboCurrent.passing} of ${mboCurrent.scored} scored agents cleared every gate`,
      axisMax: 100,
    },
    {
      label: "Mean MBO attainment",
      value: mboCurrent.overall,
      prior: mboPrior?.overall ?? null,
      target: ANALYTICS_TARGETS.attainment,
      higherIsBetter: true,
      unit: "%",
      decimals: 1,
      hint: "Average share of gates met per agent",
      axisMax: 100,
    },
    {
      label: "Open action items",
      value: analyticsCurrent.openIssues,
      prior: analyticsPrior?.openIssues ?? null,
      target: ANALYTICS_TARGETS.openIssues,
      higherIsBetter: false,
      unit: "",
      decimals: 0,
      hint: "Opened by a failed gate and not yet resolved",
      axisMax: Math.max(ANALYTICS_TARGETS.openIssues * 1.5, analyticsCurrent.openIssues * 1.2, 1),
    },
    {
      label: "Critical errors",
      value: criticalErrorsCurrent,
      prior: criticalErrorsPrior,
      target: ANALYTICS_TARGETS.criticalErrors,
      higherIsBetter: false,
      unit: "",
      decimals: 0,
      hint: "Compliance-impacting errors flagged in QA",
      axisMax: Math.max(ANALYTICS_TARGETS.criticalErrors * 2, criticalErrorsCurrent * 1.2, 1),
    },
  ];

  const struggling = [...analyticsCurrent.bySupervisor]
    .slice(0, 5)
    .map((row) => ({
      name: row.label,
      site: supervisorSite.get(row.label) ?? "—",
      failing: row.failing,
      headcount: row.employees,
      rate: row.failRate,
      tone: (row.failRate >= 35 ? "fail" : row.failRate >= 25 ? "warn" : "muted") as Tone,
    }));

  const priorKpiFailRate = new Map((analyticsPrior?.kpis ?? []).map((k) => [k.code, k.failRate]));
  const kpiFails = analyticsCurrent.kpis.map((k) => {
    const prior = priorKpiFailRate.get(k.code) ?? null;
    return {
      name: k.name,
      rate: k.failRate,
      tone: (k.failRate >= 20 ? "fail" : k.failRate >= 15 ? "warn" : "muted") as Tone,
      delta: prior !== null ? k.failRate - prior : null,
    };
  });

  // ---- Teams tab -----------------------------------------------------
  const cphRows = cphChartRows(skillMetrics);
  const ahtRows = ahtChartRows(skillMetrics);
  const priorPassBySupervisor = mboPrior
    ? new Map(flattenSupervisors(mboPrior).map(({ node }) => [node.label, node.passRate]))
    : new Map<string, number | null>();
  const openBySupervisor = new Map(analyticsCurrent.bySupervisor.map((r) => [r.label, r.openIssues]));

  interface TeamRow {
    name: string;
    manager: string;
    site: string;
    headcount: number;
    passRate: number | null;
    passRatePrior: number | null;
    openItems: number;
    cph: number | null;
    aht: number | null;
  }

  const teamRows: TeamRow[] = flattenSupervisors(mboCurrent).map(({ node, manager, site }) => ({
    name: node.label,
    manager,
    site,
    headcount: node.headcount,
    passRate: node.passRate,
    passRatePrior: priorPassBySupervisor.get(node.label) ?? null,
    openItems: openBySupervisor.get(node.label) ?? 0,
    cph: weightedAverage(cphRows, node.label, "cph"),
    aht: weightedAverage(ahtRows, node.label, "aht"),
  }));

  const sorters: Record<Sort, (a: TeamRow, b: TeamRow) => number> = {
    pass: (a, b) => (a.passRate ?? -1) - (b.passRate ?? -1),
    open: (a, b) => b.openItems - a.openItems,
    site: (a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name),
  };
  const sortedTeams = [...teamRows].sort(sorters[sort]);

  type DisplayRow = TeamRow & { isGroup: boolean; sub: string };
  let displayRows: DisplayRow[];
  if (sort === "site") {
    displayRows = [];
    for (const site of mboCurrent.sites) {
      const group = sortedTeams.filter((r) => r.site === site.label);
      if (group.length === 0) continue;
      const priorSite = mboPrior?.sites.find((s) => s.label === site.label) ?? null;
      const siteSupervisors = new Set(group.map((r) => r.name));
      const inSite = (row: SkillSupervisorRow) => siteSupervisors.has(row.supervisor);
      displayRows.push(
        {
          name: site.label,
          manager: "",
          site: site.label,
          sub: `${group.length} supervisor${group.length === 1 ? "" : "s"}`,
          headcount: site.headcount,
          passRate: site.passRate,
          passRatePrior: priorSite?.passRate ?? null,
          openItems: group.reduce((n, r) => n + r.openItems, 0),
          cph: weightedAverageRows(cphRows.filter(inSite), "cph"),
          aht: weightedAverageRows(ahtRows.filter(inSite), "aht"),
          isGroup: true,
        },
        ...group.map((r) => ({ ...r, sub: `${r.manager} · ${r.site}`, isGroup: false })),
      );
    }
  } else {
    displayRows = sortedTeams.map((r) => ({ ...r, sub: `${r.manager} · ${r.site}`, isGroup: false }));
  }

  // ---- Risks tab -------------------------------------------------------
  const ewsCards = [
    { key: "stable", label: "Stable", count: ewsCurrent.stable, prior: ewsPrior?.stable ?? null, bg: "bg-pass-bg", fg: "text-pass" },
    { key: "watch", label: "Watch", count: ewsCurrent.watch, prior: ewsPrior?.watch ?? null, bg: "bg-warn-bg", fg: "text-warn" },
    { key: "atRisk", label: "At risk", count: ewsCurrent.atRisk, prior: ewsPrior?.atRisk ?? null, bg: "bg-fail-bg", fg: "text-fail" },
    { key: "critical", label: "Critical", count: ewsCurrent.critical, prior: ewsPrior?.critical ?? null, bg: "bg-navy-900", fg: "text-cream" },
  ] as const;

  const criticalBarValues = criticalTrend.map((b) => Object.values(b.bySupervisor).reduce((a, c) => a + c, 0));
  const critBySup = Object.entries(criticalBySupervisorCurrent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({
      name,
      count,
      pct: criticalErrorsCurrent > 0 ? (count / criticalErrorsCurrent) * 100 : 0,
    }));

  // Early-warning signals need MBO history beyond current/prior — moved
  // into EarlyWarningSignalsCard below, which fetches that lazily.

  const tabControl =
    "flex h-8 min-w-8 items-center justify-center border-2 border-ink bg-surface px-2.5 text-sm font-bold text-ink";

  return (
    <>
      <PageBand
        title="Analytics"
        subtitle={`${period.label} · org-wide executive report`}
        action={
          <div className="hidden lg:block">
            <AnalyticsScene />
          </div>
        }
      />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink">
          <div className="flex">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={withParams(params, { tab: t.key === "overview" ? undefined : t.key })}
                className={`-mb-0.5 border-b-2 px-5 py-3 text-xs font-bold tracking-[0.08em] uppercase transition ${
                  tab === t.key
                    ? "border-ink bg-ink text-cream"
                    : "border-transparent text-ink hover:bg-orange-brand-100"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <span className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Period</span>
            {priorPeriod ? (
              <Link href={withParams(params, { period: priorPeriod.start })} className={`${tabControl} hover:bg-orange-brand-100`}>
                ‹
              </Link>
            ) : (
              <span className={`${tabControl} opacity-40`}>‹</span>
            )}
            <div className={`${tabControl} min-w-[150px]`}>{period.label}</div>
            {nextPeriod ? (
              <Link href={withParams(params, { period: nextPeriod.start })} className={`${tabControl} hover:bg-orange-brand-100`}>
                ›
              </Link>
            ) : (
              <span className={`${tabControl} opacity-40`}>›</span>
            )}
            <GranularitySelect granularity={granularity} options={GRANULARITIES} labels={GRANULARITY_LABELS} />
          </div>
        </div>

        {tab === "overview" && (
          <div className="pt-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
              {kpis.map((k) => (
                <KpiCard key={k.label} kpi={k} />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
              <Suspense
                fallback={
                  <ChartSkeleton
                    title={`MBO pass rate, trailing ${trendBuckets.length} ${periodNoun}${trendBuckets.length === 1 ? "" : "s"}`}
                    subtitle="Share of scored people clearing every gate"
                  />
                }
              >
                <MboTrendChart trendBuckets={trendBuckets} mboCurrent={mboCurrent} mboPrior={mboPrior} periodNoun={periodNoun} />
              </Suspense>

              <ChartFrame
                title="Teams needing attention"
                subtitle={`Supervisors with the highest share of agents failing an MBO gate in ${period.label}`}
              >
                {struggling.length === 0 ? (
                  <EmptyState title="Nothing to flag" description="No supervisor has a failing agent this period." />
                ) : (
                  <div className="space-y-1">
                    {struggling.map((s) => (
                      <div
                        key={s.name}
                        className="grid grid-cols-[minmax(120px,1.2fr)_minmax(0,2fr)_56px] items-center gap-3.5 border-b-2 border-line py-3 last:border-0"
                      >
                        <div>
                          <div className="text-sm font-bold text-ink">{s.name}</div>
                          <div className="text-xs text-muted">
                            {s.site} · {s.failing} of {s.headcount} agents
                          </div>
                        </div>
                        <div className="h-[22px] bg-line">
                          <div
                            className={`h-full ${s.tone === "muted" ? "bg-ink" : TONE_BAR[s.tone]}`}
                            style={{ width: `${Math.min(100, s.rate)}%` }}
                          />
                        </div>
                        <div className={`text-right text-lg font-extrabold tabular-nums ${TONE_TEXT[s.tone === "muted" ? "muted" : s.tone]}`}>
                          {s.rate.toFixed(0)}%
                        </div>
                      </div>
                    ))}
                    <p className="pt-3 text-xs text-muted">
                      Full breakdown under{" "}
                      <Link href={withParams(params, { tab: "teams" })} className="font-bold underline underline-offset-4">
                        Teams
                      </Link>
                      .
                    </p>
                  </div>
                )}
              </ChartFrame>
            </div>

            <div className="mt-4 border-2 border-ink bg-surface">
              <div className="border-b-2 border-ink px-5 py-4">
                <div className="text-base font-bold text-ink">Which gates are failing</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Share of evaluated agent-weeks below target, by KPI · {period.label}
                </div>
              </div>
              {kpiFails.length === 0 ? (
                <EmptyState title="No KPI data" description="No KPI gates were evaluated this period." />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                  {kpiFails.map((f) => (
                    <div key={f.name} className="border-r-2 border-b-2 border-line px-5 py-[18px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-[13px] font-bold text-ink">{f.name}</div>
                        <div className={`text-[22px] font-extrabold tabular-nums ${TONE_TEXT[f.tone]}`}>{f.rate.toFixed(1)}%</div>
                      </div>
                      <div className="mt-2.5 h-2 bg-line">
                        <div className={`h-full ${TONE_BAR[f.tone]}`} style={{ width: `${Math.min(100, f.rate * 2.5)}%` }} />
                      </div>
                      <div className="mt-2 text-xs text-muted">
                        {f.delta !== null ? fmtDelta(f.delta, " pt") : "—"} vs prior
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "teams" && (
          <div className="pt-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {SORTS.map((o) => (
                <Link
                  key={o.key}
                  href={withParams(params, { sort: o.key === "pass" ? undefined : o.key })}
                  className={`border-2 border-ink px-3 py-1.5 text-xs font-bold ${
                    sort === o.key ? "bg-ink text-cream" : "bg-surface text-ink hover:bg-orange-brand-100"
                  }`}
                >
                  {o.label}
                </Link>
              ))}
            </div>

            {displayRows.length === 0 ? (
              <Card>
                <EmptyState title="No supervisors in scope" description="Nobody has data for this period yet." />
              </Card>
            ) : (
              <div className="overflow-x-auto border-2 border-ink bg-surface">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
                      <th className="px-5 py-3 text-left">Supervisor</th>
                      <th className="px-3 py-3 text-left">Headcount</th>
                      <th className="px-3 py-3 text-left">Pass rate</th>
                      <th className="px-3 py-3 text-left">vs prior</th>
                      <th className="px-3 py-3 text-left">Open items</th>
                      <th className="px-3 py-3 text-left">Cases / hr</th>
                      <th className="px-3 py-3 text-left">AHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r, i) => {
                      const passTone: Tone = r.passRate === null ? "muted" : kpiTone(r.passRate, ANALYTICS_TARGETS.passRate, true);
                      const delta = r.passRate !== null && r.passRatePrior !== null ? r.passRate - r.passRatePrior : null;
                      return (
                        <tr
                          key={`${r.name}-${i}`}
                          className={`border-b-2 ${r.isGroup ? "border-ink bg-cream font-extrabold" : "border-line bg-surface font-medium"}`}
                        >
                          <td className={`px-5 ${r.isGroup ? "py-2.5" : "py-3.5"}`}>
                            <div className="flex items-center gap-2.5">
                              <span className={`h-2.5 w-2.5 shrink-0 ${TONE_BAR[passTone]}`} />
                              <div>
                                <div className="text-ink">{r.name}</div>
                                <div className="text-xs font-medium text-muted">{r.sub}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 tabular-nums text-ink">{r.headcount}</td>
                          <td className="px-3">
                            <div className="flex items-center gap-2.5">
                              <div className="h-2 max-w-[90px] flex-1 bg-line">
                                <div
                                  className={`h-full ${TONE_BAR[passTone]}`}
                                  style={{ width: `${r.passRate === null ? 0 : Math.min(100, r.passRate)}%` }}
                                />
                              </div>
                              <span className={`font-bold tabular-nums ${TONE_TEXT[passTone]}`}>
                                {r.passRate === null ? "—" : `${r.passRate.toFixed(0)}%`}
                              </span>
                            </div>
                          </td>
                          <td className={`px-3 font-bold tabular-nums ${delta === null ? "text-muted" : TONE_TEXT[deltaTone(delta, true)]}`}>
                            {delta === null ? "—" : fmtDelta(delta, " pt", 0)}
                          </td>
                          <td className="px-3 tabular-nums text-ink">{r.openItems}</td>
                          <td className="px-3 tabular-nums text-ink">{r.cph === null ? "—" : r.cph.toFixed(1)}</td>
                          <td className="px-3 tabular-nums text-ink">{r.aht === null ? "—" : `${Math.round(r.aht)}s`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Pass rate is the share of scored agents clearing every applicable MBO gate. Cases per hour covers
              skills scored on case rate; AHT covers skills scored on handle time.
            </p>
          </div>
        )}

        {tab === "risks" && (
          <div className="pt-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {ewsCards.map((e) => {
                const delta = e.prior !== null ? e.count - e.prior : null;
                return (
                  <div key={e.key} className={`border-2 border-ink px-5 py-[18px] ${e.bg} ${e.fg}`}>
                    <div className="text-[11px] font-bold tracking-[0.16em] uppercase">{e.label}</div>
                    <div className="mt-3 text-[40px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">{e.count}</div>
                    <div className="mt-2 text-xs opacity-85">
                      {delta === null ? "No prior period" : fmtDelta(delta, "", 0)} vs prior
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
              <ChartFrame
                title={`Critical errors, trailing ${trendBuckets.length} ${periodNoun}${trendBuckets.length === 1 ? "" : "s"}`}
                subtitle={`Org total per ${periodNoun} · the three supervisors carrying most of them`}
              >
                <TrendBarChart
                  buckets={trendBuckets.map((p) => p.label)}
                  values={criticalBarValues}
                  selectedIndex={criticalBarValues.length - 1}
                />
                {critBySup.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">No critical errors recorded this period.</p>
                ) : (
                  <div className="mt-3">
                    {critBySup.map((c) => (
                      <div key={c.name} className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2fr)_40px] items-center gap-3.5 border-t-2 border-line py-2.5 text-[13px]">
                        <div className="font-bold text-ink">{c.name}</div>
                        <div className="h-3.5 bg-line">
                          <div className="h-full bg-fail" style={{ width: `${c.pct}%` }} />
                        </div>
                        <div className="text-right font-extrabold tabular-nums text-ink">{c.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </ChartFrame>

              <Suspense
                fallback={
                  <ChartSkeleton
                    title="Early warning signals"
                    subtitle={`Patterns that need a decision this ${periodNoun}`}
                  />
                }
              >
                <EarlyWarningSignalsCard
                  trendBuckets={trendBuckets}
                  mboCurrent={mboCurrent}
                  mboPrior={mboPrior}
                  priorPeriod={priorPeriod}
                  analyticsCurrent={analyticsCurrent}
                  analyticsPrior={analyticsPrior}
                  criticalBySupervisorCurrent={criticalBySupervisorCurrent}
                  criticalErrorsCurrent={criticalErrorsCurrent}
                  supervisorSite={supervisorSite}
                  skillMetrics={skillMetrics}
                  skillMetricsPrior={skillMetricsPrior}
                  periodNoun={periodNoun}
                />
              </Suspense>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-muted">
          Read-only, org-wide view for administrators. For a filtered team breakdown, use the Dashboard tab.
        </p>
      </main>
    </>
  );
}
