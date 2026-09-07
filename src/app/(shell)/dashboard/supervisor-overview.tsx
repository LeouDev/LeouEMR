"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatMetric } from "@/components/ui";
import type { TeamTrendSeries } from "@/lib/queries/team-trend";
import {
  ActionItemsSummary,
  DashboardShell,
  type ShellActionItems,
  type ShellSeries,
} from "./dashboard-shell";
import { KPI_GROUPS, KPI_ORDER, directionLabel, orderIndex } from "./agent-performance";

export interface TeamKpi {
  code: string;
  name: string;
  /** Mean across the agents scored on it this period. */
  avg: number;
  target: number | null;
  below: number;
  scored: number;
}

export interface TeamSummaryStats {
  failing: number;
  atRisk: number;
  measured: number;
  total: number;
  parPassing: number;
  parScored: number;
  mboPassing: number;
  mboScored: number;
  mboFailing: number;
  mboFailHref: string;
}

/**
 * A third of the team below target is where an average stops being the story.
 *
 * Below that a team reads as a few individuals needing attention — which the
 * agent table underneath names. At or above it the measure itself is the
 * problem, and the cell says so in red rather than leaving a healthy-looking
 * mean to speak for a team that is not healthy.
 */
const WIDESPREAD = 1 / 3;

export function SupervisorOverview({
  kpis,
  series,
  actionItems,
  stats,
  periodLabel,
}: {
  kpis: TeamKpi[];
  series: TeamTrendSeries[];
  actionItems: ShellActionItems;
  stats: TeamSummaryStats;
  periodLabel: string;
}) {
  const byCode = useMemo(() => new Map(kpis.map((k) => [k.code, k])), [kpis]);

  const groups = KPI_GROUPS.map((group) => ({
    name: group.name,
    kpis: group.codes.map((code) => byCode.get(code)).filter((k): k is TeamKpi => Boolean(k)),
  })).filter((group) => group.kpis.length > 0);

  const shellSeries: ShellSeries[] = useMemo(
    () =>
      [...series]
        .sort((a, b) => orderIndex(a.kpiCode) - orderIndex(b.kpiCode))
        .map((s) => ({
          key: s.kpiCode,
          label: s.kpiName,
          note: "line = team average · bars = agents below target",
          target: s.target,
          format: s.kpiCode,
          points: s.points.map((p) => ({
            weekStart: p.weekStart,
            value: p.avg,
            // The mean alone hides the shape of a team: one agent at 40% and
            // nine at 100% averages to a comfortable 94%.
            bar: { value: p.below, of: p.scored, label: `${p.below} below` },
            caption: `${p.below} of ${p.scored} below target`,
          })),
        })),
    [series],
  );

  // Open on the measure most of the team is missing, not merely the first one.
  const worst = [...kpis]
    .filter((k) => k.scored > 0 && k.below > 0 && shellSeries.some((s) => s.key === k.code))
    .sort((a, b) => b.below / b.scored - a.below / a.scored || orderIndex(a.code) - orderIndex(b.code))[0];

  const summary = (
    <>
      <div>
        <h6 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">Summary</h6>
        <div className="mt-1.5 font-sans text-[56px] leading-none font-extrabold">
          <span className={stats.failing > 0 ? "text-fail" : "text-pass"}>{stats.failing}</span>
          <span className="text-ink-faint">/{stats.total}</span>
        </div>
        <p className="mt-1.5 text-[13px] text-ink">
          agent{stats.failing === 1 ? "" : "s"} with a failing KPI · {periodLabel}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {stats.atRisk} more at risk · {stats.measured} of {stats.total} with data
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">Passing PAR</span>
          <span>
            {stats.parScored === 0 ? "—" : `${stats.parPassing} of ${stats.parScored} scored`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Passing MBO</span>
          <span>{stats.mboScored === 0 ? "—" : `${stats.mboPassing} of ${stats.mboScored}`}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Failing MBO</span>
          {stats.mboFailing > 0 ? (
            <Link href={stats.mboFailHref} className="font-semibold text-fail hover:underline">
              {stats.mboFailing} · see gates
            </Link>
          ) : (
            <span className="text-ink">none</span>
          )}
        </div>
      </div>

      <ActionItemsSummary items={actionItems} />
    </>
  );

  return (
    <DashboardShell
      summary={summary}
      series={shellSeries}
      trendTitle="Team trend"
      defaultSeriesKey={worst?.code ?? null}
      emptyTrendMessage="No week-by-week history for your team yet."
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
                  const widespread = kpi.scored > 0 && kpi.below / kpi.scored >= WIDESPREAD;
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
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`font-mono text-[34px] leading-none font-extrabold tabular-nums ${
                            widespread ? "text-fail" : "text-ink"
                          }`}
                        >
                          {formatMetric(kpi.avg, kpi.code)}
                        </span>
                        <span className="text-[11px] text-muted">team avg</span>
                      </span>
                      <span className="text-xs text-muted">
                        {kpi.target === null
                          ? "no target"
                          : `target ${formatMetric(kpi.target, kpi.code)}`}
                        {" · "}
                        {kpi.below === 0 ? (
                          <span>everyone on target</span>
                        ) : (
                          <span className={widespread ? "text-fail" : "text-muted"}>
                            {kpi.below} of {kpi.scored} below
                          </span>
                        )}
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

export { KPI_ORDER, directionLabel };
