"use client";

import { useMemo } from "react";
import { formatMetric } from "@/components/ui";
import type { TrendSeries } from "@/lib/queries/trend";
import {
  ActionItemsSummary,
  DashboardShell,
  type ShellActionItems,
  type ShellSeries,
} from "./dashboard-shell";

export interface AgentKpi {
  code: string;
  name: string;
  value: number;
  target: number | null;
  /** Upper case, or null where the figure is not scored against a target. */
  status: string | null;
  /** Signed change from the previous period, in the metric's own units. */
  delta: number | null;
  /** Whether `delta` moved the good way. Null for no prior, no change, or no direction. */
  improved: boolean | null;
  previous: number | null;
}

/**
 * KPIs grouped by what they measure rather than listed flat.
 *
 * Ten equal tiles made every measure look equally important and left an agent
 * to work out for themselves that MBO is a composite of the others. Grouping
 * says which is which, and lets the summary column report a group at a time.
 */
export const KPI_GROUPS: Array<{ name: string; codes: string[] }> = [
  { name: "Composite", codes: ["MBO"] },
  // Case rate sits with the other output measures: it is what a case-rate
  // agent is scored on in place of cases per hour, never alongside it.
  { name: "Output", codes: ["PRODUCTION_RATE", "CPH", "CASE_RATE", "AHT"] },
  { name: "Quality", codes: ["QUALITY", "DPU", "DPO", "CRITICAL_ERRORS"] },
  { name: "Engagement", codes: ["ATTENDANCE", "NPS"] },
];

/** Headline measures first, matching the order the groups are read in. */
export const KPI_ORDER = KPI_GROUPS.flatMap((g) => g.codes);

export function orderIndex(code: string): number {
  const i = KPI_ORDER.indexOf(code);
  return i < 0 ? 99 : i;
}

export function directionLabel(direction: string): string | null {
  if (direction === "higher_is_better") return "Higher is better";
  if (direction === "lower_is_better") return "Lower is better";
  return null;
}

export function AgentPerformance({
  kpis,
  series,
  actionItems,
  periodLabel,
}: {
  kpis: AgentKpi[];
  series: TrendSeries[];
  actionItems: ShellActionItems;
  periodLabel: string;
}) {
  const byCode = useMemo(() => new Map(kpis.map((k) => [k.code, k])), [kpis]);

  // Only KPIs that are actually scored can be below target, so the headline
  // counts those. Case rate has no target and would otherwise pad the
  // denominator with something that can never fail.
  const scored = kpis.filter((k) => k.status !== null);
  const failing = scored.filter((k) => k.status === "FAIL");

  const groups = KPI_GROUPS.map((group) => ({
    name: group.name,
    kpis: group.codes.map((code) => byCode.get(code)).filter((k): k is AgentKpi => Boolean(k)),
  })).filter((group) => group.kpis.length > 0);

  const shellSeries: ShellSeries[] = useMemo(
    () =>
      [...series]
        .sort((a, b) => orderIndex(a.kpiCode) - orderIndex(b.kpiCode))
        .map((s) => ({
          key: s.kpiCode,
          label: s.kpiName,
          note: [
            directionLabel(s.direction) ?? "No single good direction",
            s.target === null ? null : `target ${formatMetric(s.target, s.kpiCode)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          target: s.target,
          format: s.kpiCode,
          points: s.points.map((p) => ({
            weekStart: p.weekStart,
            value: p.value,
            status: p.status,
          })),
        })),
    [series],
  );

  // Open on whatever is wrong: the first failing KPI in reading order. With
  // nothing failing there is no story to lead with, so it opens on the first
  // measure instead.
  const defaultKey =
    KPI_ORDER.find(
      (code) => byCode.get(code)?.status === "FAIL" && shellSeries.some((s) => s.key === code),
    ) ?? null;

  const summary = (
    <>
      <div>
        <h6 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">Summary</h6>
        <div className="mt-1.5 font-sans text-[56px] leading-none font-extrabold">
          <span className={failing.length > 0 ? "text-fail" : "text-pass"}>{failing.length}</span>
          <span className="text-ink-faint">/{scored.length}</span>
        </div>
        <p className="mt-1.5 text-[13px] text-ink">
          {scored.length === 0
            ? "Nothing scored this period"
            : `KPI${failing.length === 1 ? "" : "s"} below target · ${periodLabel}`}
        </p>
      </div>

      {groups.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
          {groups.map((group) => {
            const below = group.kpis.filter((k) => k.status === "FAIL").length;
            return (
              <div key={group.name} className="flex justify-between">
                <span className="text-muted">{group.name}</span>
                {below > 0 ? (
                  <span className="font-semibold text-fail">{below} below</span>
                ) : (
                  <span className="text-ink">on target</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ActionItemsSummary items={actionItems} />
    </>
  );

  return (
    <DashboardShell
      summary={summary}
      series={shellSeries}
      trendTitle="Trend"
      defaultSeriesKey={defaultKey}
      rows={({ selected, select, chartable }) => (
        <>
          {groups.map((group) => (
            <div key={group.name} className="grid border-b-2 border-ink lg:grid-cols-[120px_1fr]">
              <div className="py-3 text-[11px] font-bold tracking-[0.1em] text-muted uppercase lg:py-5 lg:pl-6">
                {group.name}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {group.kpis.map((kpi) => {
                  const isCharted = selected === kpi.code;
                  const canChart = chartable.has(kpi.code);
                  return (
                    <button
                      key={kpi.code}
                      type="button"
                      onClick={() => select(kpi.code)}
                      disabled={!canChart}
                      aria-pressed={isCharted}
                      className={`flex flex-col gap-1 px-5 py-4 text-left transition ${
                        canChart ? "cursor-pointer hover:bg-cream" : "cursor-default"
                      } ${isCharted ? "bg-cream shadow-[inset_0_-3px_0_var(--color-orange-brand)]" : ""}`}
                    >
                      <span className="flex items-baseline justify-between gap-2 text-xs text-muted">
                        <span>{kpi.name}</span>
                        {isCharted && (
                          <span className="text-[10px] font-semibold tracking-[0.08em] text-orange-brand uppercase">
                            Charted
                          </span>
                        )}
                      </span>
                      <span
                        className={`font-mono text-[34px] leading-none font-extrabold tabular-nums ${
                          kpi.status === "FAIL" ? "text-fail" : "text-ink"
                        }`}
                      >
                        {formatMetric(kpi.value, kpi.code)}
                      </span>
                      <span className="text-xs text-muted">
                        {kpi.target === null
                          ? "no target"
                          : `target ${formatMetric(kpi.target, kpi.code)}`}
                        {" · "}
                        <Delta kpi={kpi} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    />
  );
}

/**
 * The change from the previous period.
 *
 * The arrow follows the sign of the change and the colour follows whether it
 * was an improvement — deliberately decoupled, because for handle time and
 * critical errors a fall is the good outcome. Colour is only ever spent on a
 * genuine regression; an improvement stays quiet.
 */
function Delta({ kpi }: { kpi: AgentKpi }) {
  if (kpi.delta === null || Math.abs(kpi.delta) < 0.005) {
    return <span>{kpi.previous === null ? "new" : "no change"}</span>;
  }
  return (
    <span className={kpi.improved === false ? "text-fail" : "text-muted"}>
      {kpi.delta > 0 ? "▲" : "▼"} {formatMetric(Math.abs(kpi.delta), kpi.code)}
    </span>
  );
}
