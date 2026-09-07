"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatMetric } from "@/components/ui";
import type { TrendSeries } from "@/lib/queries/trend";

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

export interface AgentActionItems {
  open: number;
  awaiting: number;
  monitoring: number;
  sustained: number;
  overdue: number;
}

/**
 * KPIs grouped by what they measure rather than listed flat.
 *
 * Ten equal tiles made every measure look equally important and left an agent
 * to work out for themselves that MBO is a composite of the others. Grouping
 * says which is which, and lets the summary column report a group at a time.
 */
const GROUPS: Array<{ name: string; codes: string[] }> = [
  { name: "Composite", codes: ["MBO"] },
  // Case rate sits with the other output measures: it is what a case-rate
  // agent is scored on in place of cases per hour, never alongside it.
  { name: "Output", codes: ["PRODUCTION_RATE", "CPH", "CASE_RATE", "AHT"] },
  { name: "Quality", codes: ["QUALITY", "DPU", "DPO", "CRITICAL_ERRORS"] },
  { name: "Engagement", codes: ["ATTENDANCE", "NPS"] },
];

/** Headline measures first, matching the order the groups are read in. */
const KPI_ORDER = GROUPS.flatMap((g) => g.codes);

const RANGES = [6, 12] as const;
type Range = (typeof RANGES)[number];

const STORE_KPI = "dashboard.trendKpi";
const STORE_RANGE = "dashboard.trendRange";

/** "Aug 16" — a full week range is too long to repeat twelve times on an axis. */
function shortWeek(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function directionLabel(direction: string): string | null {
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
  actionItems: AgentActionItems;
  periodLabel: string;
}) {
  const byCode = useMemo(() => new Map(kpis.map((k) => [k.code, k])), [kpis]);

  // Only KPIs that are actually scored can be below target, so the headline
  // counts those. Case rate has no target and would otherwise pad the
  // denominator with something that can never fail.
  const scored = kpis.filter((k) => k.status !== null);
  const failing = scored.filter((k) => k.status === "FAIL");

  const chartable = useMemo(
    () =>
      [...series]
        .filter((s) => s.points.length > 0)
        .sort((a, b) => {
          const ai = KPI_ORDER.indexOf(a.kpiCode);
          const bi = KPI_ORDER.indexOf(b.kpiCode);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        }),
    [series],
  );

  // Open on whatever is wrong: the first failing KPI in reading order. With
  // nothing failing there is no story to lead with, so it opens on the first
  // measure instead.
  const defaultKpi =
    KPI_ORDER.find((code) => byCode.get(code)?.status === "FAIL" && chartable.some((s) => s.kpiCode === code)) ??
    chartable[0]?.kpiCode ??
    null;

  const [selected, setSelected] = useState<string | null>(defaultKpi);
  const [range, setRange] = useState<Range>(12);

  // Read after mount rather than during render: the server has no
  // localStorage, and seeding state from it directly would hydrate a
  // different chart than the markup the server sent.
  useEffect(() => {
    try {
      const storedKpi = window.localStorage.getItem(STORE_KPI);
      if (storedKpi && chartable.some((s) => s.kpiCode === storedKpi)) setSelected(storedKpi);
      const storedRange = Number(window.localStorage.getItem(STORE_RANGE));
      if (RANGES.includes(storedRange as Range)) setRange(storedRange as Range);
    } catch {
      // Private browsing, or storage disabled. The defaults are fine.
    }
  }, [chartable]);

  const choose = (code: string) => {
    if (!chartable.some((s) => s.kpiCode === code)) return;
    setSelected(code);
    try {
      window.localStorage.setItem(STORE_KPI, code);
    } catch {}
  };

  const chooseRange = (value: Range) => {
    setRange(value);
    try {
      window.localStorage.setItem(STORE_RANGE, String(value));
    } catch {}
  };

  const active = chartable.find((s) => s.kpiCode === selected) ?? chartable[0] ?? null;
  const points = active ? active.points.slice(-range) : [];

  const groups = GROUPS.map((group) => ({
    name: group.name,
    kpis: group.codes.map((code) => byCode.get(code)).filter((k): k is AgentKpi => Boolean(k)),
  })).filter((group) => group.kpis.length > 0);

  return (
    <section className="border-t-2 border-ink">
      <div className="grid lg:grid-cols-[280px_1fr]">
        {/* Summary */}
        <div className="flex flex-col gap-6 border-b-2 border-ink py-6 pr-6 lg:border-b-0 lg:border-r-2">
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

          <div className="border-t border-line pt-3.5">
            <h6 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              Action items
            </h6>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
              <strong className="font-mono tabular-nums">{actionItems.open}</strong>
              <span>active</span>
              <strong className="font-mono tabular-nums">{actionItems.sustained}</strong>
              <span>sustained</span>
              {actionItems.awaiting > 0 && (
                <>
                  <strong className="font-mono text-warn tabular-nums">{actionItems.awaiting}</strong>
                  <span className="text-warn">awaiting acknowledgement</span>
                </>
              )}
              {actionItems.monitoring > 0 && (
                <>
                  <strong className="font-mono tabular-nums">{actionItems.monitoring}</strong>
                  <span>monitoring</span>
                </>
              )}
              {actionItems.overdue > 0 && (
                <>
                  <strong className="font-mono text-fail tabular-nums">{actionItems.overdue}</strong>
                  <span className="text-fail">overdue</span>
                </>
              )}
              {/* Three zeros deserve one quiet line, not three rows of nothing. */}
              {actionItems.awaiting === 0 && actionItems.monitoring === 0 && actionItems.overdue === 0 && (
                <>
                  <strong className="font-mono text-ink-faint tabular-nums">0</strong>
                  <span className="text-muted">awaiting ack · monitoring · overdue</span>
                </>
              )}
            </div>
            <Link
              href="/action-items"
              className="mt-3 block w-full border border-line px-3 py-1.5 text-left text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
            >
              All action items →
            </Link>
          </div>
        </div>

        {/* KPI groups */}
        <div className="flex flex-col">
          {groups.map((group) => (
            <div key={group.name} className="grid border-b-2 border-ink lg:grid-cols-[120px_1fr]">
              <div className="py-3 text-[11px] font-bold tracking-[0.1em] text-muted uppercase lg:py-5 lg:pl-6">
                {group.name}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {group.kpis.map((kpi) => {
                  const isCharted = active?.kpiCode === kpi.code;
                  const canChart = chartable.some((s) => s.kpiCode === kpi.code);
                  return (
                    <button
                      key={kpi.code}
                      type="button"
                      onClick={() => choose(kpi.code)}
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
                        {kpi.target === null ? "no target" : `target ${formatMetric(kpi.target, kpi.code)}`}
                        {" · "}
                        <Delta kpi={kpi} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Trend */}
          <div className="pt-5 lg:pl-6">
            {active === null ? (
              <p className="py-8 text-center text-sm text-muted">
                No week-by-week history for this period yet.
              </p>
            ) : (
              <>
                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-wrap gap-1.5">
                    {chartable.map((s) => (
                      <button
                        key={s.kpiCode}
                        type="button"
                        onClick={() => choose(s.kpiCode)}
                        className={`border px-2.5 py-1 text-xs transition ${
                          s.kpiCode === active.kpiCode
                            ? "border-ink bg-ink text-white"
                            : "border-line text-ink hover:border-ink"
                        }`}
                      >
                        {s.kpiName}
                      </button>
                    ))}
                  </div>
                  <div className="flex shrink-0 border-2 border-ink">
                    {RANGES.map((option, i) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => chooseRange(option)}
                        className={`cursor-pointer px-3 py-1 text-xs font-semibold ${
                          i > 0 ? "border-l-2 border-ink" : ""
                        } ${
                          range === option
                            ? "bg-ink text-white"
                            : "bg-surface text-ink hover:bg-orange-brand-100"
                        }`}
                      >
                        {option} wk
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h6 className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
                    Trend · {active.kpiName}
                  </h6>
                  <span className="text-xs text-muted">
                    {directionLabel(active.direction) ?? "No single good direction"}
                    {active.target !== null &&
                      ` · target ${formatMetric(active.target, active.kpiCode)}`}
                  </span>
                </div>

                <TrendLine
                  points={points}
                  target={active.target}
                  kpiCode={active.kpiCode}
                  requested={range}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
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

/**
 * One KPI's recent weeks as a line.
 *
 * Weeks are plotted evenly rather than by date, matching the analytics trend
 * chart: the ledger has one point per reporting week, and even spacing keeps
 * a gap in the data from bending the slope either side of it.
 */
function TrendLine({
  points,
  target,
  kpiCode,
  requested,
}: {
  points: Array<{ weekStart: string; value: number; status: string | null }>;
  target: number | null;
  kpiCode: string;
  requested: number;
}) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No weeks with data in this range.</p>;
  }

  const W = 720;
  const H = 170;
  const PAD = { top: 16, right: 52, bottom: 24, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // The target belongs inside the domain: a line drawn off the top of the
  // chart tells you nothing about how far off target you are.
  const values = [...points.map((p) => p.value), ...(target === null ? [] : [target])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.15 || 1;
  // Headroom must not invent territory the metric cannot reach: padding an
  // MBO that bottomed out at zero produced an axis starting at -15%. Only
  // clamp when the data itself is non-negative, so a KPI that genuinely can
  // go below zero still gets its room.
  const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const max = hi + pad;

  const x = (i: number) => (points.length === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const last = points[points.length - 1];
  const lastFails = last.status === "FAIL";
  const labelEvery = Math.ceil(points.length / 6);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Trend for ${kpiCode}`}>
        {[max, min].map((v) => (
          <text
            key={v}
            x={PAD.left - 8}
            y={y(v) + 3}
            textAnchor="end"
            className="fill-muted text-[11px]"
          >
            {formatMetric(v, kpiCode)}
          </text>
        ))}

        {target !== null && (
          <>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(target)}
              y2={y(target)}
              stroke="var(--color-orange-brand)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <text
              x={W - PAD.right}
              y={y(target) - 5}
              textAnchor="end"
              className="fill-orange-brand text-[10px]"
            >
              target {formatMetric(target, kpiCode)}
            </text>
          </>
        )}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--color-ink)"
          strokeWidth={2}
        />

        {/* A single point has no slope to draw; the dot alone is the honest mark. */}
        {points.length > 1 && (
          <path d={line} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {points.map((p, i) => (
          <g key={p.weekStart}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={i === points.length - 1 ? 6 : 3.5}
              fill={i === points.length - 1 && lastFails ? "var(--color-fail)" : "var(--color-ink)"}
            >
              <title>{`${shortWeek(p.weekStart)} — ${formatMetric(p.value, kpiCode)}`}</title>
            </circle>
            {(i % labelEvery === 0 || i === points.length - 1) && (
              <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">
                {shortWeek(p.weekStart)}
              </text>
            )}
          </g>
        ))}

        <text
          x={x(points.length - 1) + 10}
          y={y(last.value) + 4}
          className={`text-[12px] font-bold ${lastFails ? "fill-fail" : "fill-ink"}`}
        >
          {formatMetric(last.value, kpiCode)}
        </text>
      </svg>

      {/* Never let a short series pass for a full one. */}
      {points.length < requested && (
        <p className="mt-1 text-xs text-muted">
          {points.length} of the last {requested} weeks have data for this KPI.
        </p>
      )}
    </>
  );
}
