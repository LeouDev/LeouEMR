import { BarList, ChartFrame, TrendBarChart, TrendLineChart } from "@/components/charts";
import { NavLink } from "@/components/nav-link";
import {
  GRAIN_LABELS,
  GROUP_LABELS,
  parseGrain,
  parseGroupBy,
  summarize,
  windowFor,
  windowLabel,
  type Grain,
  type GroupBy,
} from "@/lib/quality/analysis";
import { PASS_THRESHOLD } from "@/lib/quality/scoring";
import { getQaAnalysisInput } from "@/lib/queries/quality";
import { canFileAudit } from "@/lib/auth/scope";
import { requireQualityUser, todayIso } from "../access";
import { QualityBand, QualityTabs } from "../quality-tabs";
import { CountBars, OutcomeDonut } from "./analysis-charts";

const GRAINS: Grain[] = ["daily", "weekly", "monthly"];
const GROUPS: GroupBy[] = ["leader", "manager"];

function Segmented<T extends string>({
  options,
  labels,
  active,
  href,
}: {
  options: T[];
  labels: Record<T, string>;
  active: T;
  href: (option: T) => string;
}) {
  return (
    <div className="inline-flex border-2 border-ink">
      {options.map((option, i) => (
        <NavLink
          key={option}
          href={href(option)}
          prefetch={false}
          className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${i > 0 ? "border-l-2 border-ink" : ""} ${
            active === option ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
          }`}
        >
          {labels[option]}
        </NavLink>
      ))}
    </div>
  );
}

/**
 * Team QA Analysis: every number computed from the stored audits and their
 * failed findings in the caller's scope, over the last 14 days, 12 weeks or
 * 12 months, each compared with the equal span before it.
 */
export default async function QualityAnalysisPage({ searchParams }: { searchParams: Promise<{ grain?: string; group?: string }> }) {
  const user = await requireQualityUser();
  const params = await searchParams;
  const grain = parseGrain(params.grain);
  const groupBy = parseGroupBy(params.group);
  const window = windowFor(grain, todayIso());
  const { audits, fails } = await getQaAnalysisInput(user, window);
  const analysis = summarize(audits, fails, window, groupBy);
  const last = window.buckets.length - 1;
  const query = (g: Grain, gb: GroupBy) => `/quality/analysis?${new URLSearchParams({ grain: g, group: gb })}`;

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="analysis" canFile={canFileAudit(user)} perLeader={user.role !== "supervisor"} />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {windowLabel(window)} · compared with the {GRAIN_LABELS[grain].toLowerCase()} span before it
          </p>
          <Segmented options={GRAINS} labels={GRAIN_LABELS} active={grain} href={(g) => query(g, groupBy)} />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {analysis.kpis.map((kpi) => (
            <div key={kpi.label} className="border-2 border-ink bg-surface p-4">
              <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">{kpi.label}</p>
              <p className="mt-3 text-[32px] leading-none font-extrabold tracking-[-0.01em] text-ink tabular-nums">{kpi.value}</p>
              {kpi.delta && (
                <p className={`mt-2 text-xs font-semibold ${kpi.improved ? "text-pass" : "text-fail"}`}>{kpi.delta}</p>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-5">
            <ChartFrame title="Audit score trend" subtitle={`Average audit score per ${grain === "daily" ? "day" : grain === "weekly" ? "week" : "month"} · the dashed line is the ${PASS_THRESHOLD}% pass benchmark`}>
              <TrendLineChart buckets={analysis.trend.buckets} values={analysis.trend.scores} selectedIndex={last} target={PASS_THRESHOLD} emptyMessage="Audits on at least two dates are needed to draw a trend." />
            </ChartFrame>
          </div>

          <div className="lg:col-span-3">
            <ChartFrame title={`Score by ${GROUP_LABELS[groupBy].toLowerCase()}`} subtitle="Average score, best first, with the number of audits behind it">
              <div className="mb-4">
                <Segmented options={GROUPS} labels={GROUP_LABELS} active={groupBy} href={(gb) => query(grain, gb)} />
              </div>
              <BarList
                rows={analysis.groups.map((g) => ({ label: g.label, value: g.avg, caption: `${g.count} audit${g.count === 1 ? "" : "s"}` }))}
                tone="better-when-higher"
                emptyMessage="No audits in this range."
              />
            </ChartFrame>
          </div>

          <div className="lg:col-span-2">
            <ChartFrame title="Audit outcome" subtitle={`Passed at ${PASS_THRESHOLD}% or better · critical is a compliance auto-fail`}>
              <OutcomeDonut {...analysis.outcome} />
            </ChartFrame>
          </div>

          <div className="lg:col-span-3">
            <ChartFrame title="Error categories" subtitle="Failed attributes by category, most first">
              <CountBars rows={analysis.categories} tone="fail" emptyMessage="No failed attributes in this range." />
            </ChartFrame>
          </div>

          <div className="lg:col-span-2">
            <ChartFrame title="Critical errors trend" subtitle="Compliance auto-fails per period">
              <TrendBarChart buckets={analysis.trend.buckets} values={analysis.trend.criticals} selectedIndex={last} emptyMessage="No periods to plot yet." />
            </ChartFrame>
          </div>

          <div className="lg:col-span-5">
            <ChartFrame title="Top recurring findings" subtitle="The specific attributes failed most often">
              <CountBars rows={analysis.findings} tone="ink" emptyMessage="No failed attributes in this range." />
            </ChartFrame>
          </div>
        </div>
      </main>
    </>
  );
}
