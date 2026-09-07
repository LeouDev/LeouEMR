"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { formatMetric } from "@/components/ui";

/**
 * One plottable series, whatever the view.
 *
 * Deliberately not tied to a KPI: the agent and supervisor views chart KPIs,
 * the manager view charts achievement, MBO pass rate and open items, and all
 * three want the same chips, the same range toggle and the same chart.
 */
export interface ShellSeries {
  key: string;
  label: string;
  /** Shown beside the chart title — what the number actually means. */
  note: string | null;
  target: number | null;
  /**
   * How to render a value: a KPI code for formatMetric, or "percent"/"count"
   * for the manager's derived series, which have no KPI definition.
   */
  format: string;
  points: ShellPoint[];
}

export interface ShellPoint {
  weekStart: string;
  value: number;
  /** Upper case; drives the red last-point marker. Null where unscored. */
  status?: string | null;
  /** A bar drawn behind the line — the team views' "how many were below target". */
  bar?: { value: number; of: number; label: string };
  /** Tooltip detail, e.g. "12 of 14 scored". */
  caption?: string;
}

export interface ShellActionItems {
  open: number;
  awaiting: number;
  monitoring: number;
  sustained: number;
  overdue: number;
}

const RANGES = [6, 12] as const;
export type ShellRange = (typeof RANGES)[number];

export interface ShellContext {
  /** The series currently charted. */
  selected: string | null;
  /** Chart a different series; ignored for a series with no points. */
  select: (key: string) => void;
  /** Which keys have anything to chart. */
  chartable: Set<string>;
}

const STORE_SERIES = "dashboard.trendKpi";
const STORE_RANGE = "dashboard.trendRange";

/**
 * The viewer's chip and range choice, remembered in localStorage.
 *
 * Read through useSyncExternalStore rather than copied into state by an
 * effect: the server has no localStorage, so it renders the default and React
 * swaps in the stored value on hydration. Seeding useState from storage
 * instead would hydrate different markup than the server sent, and doing it
 * in an effect costs a second render pass on every mount.
 */
const prefs = {
  listeners: new Set<() => void>(),
  subscribe(fn: () => void) {
    prefs.listeners.add(fn);
    return () => {
      prefs.listeners.delete(fn);
    };
  },
  read(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Private browsing, or storage disabled. The defaults are fine.
      return null;
    }
  },
  write(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
    for (const listener of prefs.listeners) listener();
  },
};

function usePref(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(
    prefs.subscribe,
    () => prefs.read(key),
    () => null,
  );
  return [value, (next: string) => prefs.write(key, next)];
}

/** "Aug 16" — a full week range is too long to repeat twelve times on an axis. */
export function shortWeek(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatValue(value: number, format: string): string {
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "count") return value.toFixed(0);
  return formatMetric(value, format);
}

/**
 * The shared dashboard frame: a summary column, a stack of rows, and a trend.
 *
 * Agent, supervisor and manager differ only in what fills the summary, what a
 * row looks like, and which series can be charted — so the layout, the chip
 * and range behaviour, the persistence and the chart live here once.
 */
export function DashboardShell({
  summary,
  rows,
  series,
  trendTitle,
  defaultSeriesKey,
  emptyTrendMessage = "No week-by-week history for this period yet.",
}: {
  /** Static, or a render prop when the summary itself drives the chart. */
  summary: React.ReactNode | ((ctx: ShellContext) => React.ReactNode);
  /** Given the charted series key and a setter, so a row can select itself. */
  rows: (ctx: ShellContext) => React.ReactNode;
  series: ShellSeries[];
  /** e.g. "Trend" or "Team trend"; the series label is appended. */
  trendTitle: string;
  /** Which chip opens selected — usually whatever is going wrong. */
  defaultSeriesKey?: string | null;
  emptyTrendMessage?: string;
}) {
  const chartable = useMemo(() => series.filter((s) => s.points.length > 0), [series]);
  const chartableKeys = useMemo(() => new Set(chartable.map((s) => s.key)), [chartable]);

  const [storedSeries, setStoredSeries] = usePref(STORE_SERIES);
  const [storedRange, setStoredRange] = usePref(STORE_RANGE);

  // A remembered chip that this view cannot chart falls back to the default
  // rather than leaving the chart empty — the roles share the storage key and
  // do not share every series.
  const selected =
    storedSeries && chartableKeys.has(storedSeries)
      ? storedSeries
      : (defaultSeriesKey ?? chartable[0]?.key ?? null);
  const range = RANGES.includes(Number(storedRange) as ShellRange)
    ? (Number(storedRange) as ShellRange)
    : 12;

  const select = (key: string) => {
    if (!chartableKeys.has(key)) return;
    setStoredSeries(key);
  };

  const chooseRange = (value: ShellRange) => setStoredRange(String(value));

  const active = chartable.find((s) => s.key === selected) ?? chartable[0] ?? null;
  const points = active ? active.points.slice(-range) : [];
  const context: ShellContext = {
    selected: active?.key ?? null,
    select,
    chartable: chartableKeys,
  };

  return (
    <section className="border-t-2 border-ink">
      <div className="grid lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-6 border-b-2 border-ink py-6 pr-6 lg:border-r-2 lg:border-b-0">
          {typeof summary === "function" ? summary(context) : summary}
        </div>

        <div className="flex min-w-0 flex-col">
          {rows(context)}

          <div className="pt-5 lg:pl-6">
            {active === null ? (
              <p className="py-8 text-center text-sm text-muted">{emptyTrendMessage}</p>
            ) : (
              <>
                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-wrap gap-1.5">
                    {chartable.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => select(s.key)}
                        className={`border px-2.5 py-1 text-xs transition ${
                          s.key === active.key
                            ? "border-ink bg-ink text-white"
                            : "border-line text-ink hover:border-ink"
                        }`}
                      >
                        {s.label}
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

                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
                  <h6 className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
                    {trendTitle} · {active.label}
                  </h6>
                  {active.note && <span className="text-xs text-muted">{active.note}</span>}
                </div>

                <TrendLine
                  points={points}
                  target={active.target}
                  format={active.format}
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
 * A series' recent weeks as a line, with optional bars behind it.
 *
 * Weeks are plotted evenly rather than by date, matching the analytics trend
 * chart: the ledger has one point per reporting week, and even spacing keeps
 * a gap in the data from bending the slope either side of it.
 */
export function TrendLine({
  points,
  target,
  format,
  requested,
}: {
  points: ShellPoint[];
  target: number | null;
  format: string;
  requested: number;
}) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No weeks with data in this range.</p>;
  }

  const W = 720;
  const H = 170;
  const hasBars = points.some((p) => p.bar !== undefined);
  const PAD = { top: hasBars ? 26 : 16, right: 56, bottom: 24, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // The target belongs inside the domain: a line drawn off the top of the
  // chart says nothing about how far off target you are.
  const values = [...points.map((p) => p.value), ...(target === null ? [] : [target])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.15 || 1;
  // Headroom must not invent territory the metric cannot reach: padding a
  // rate that bottomed out at zero produced an axis starting below zero.
  const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const max = hi + pad;

  const x = (i: number) =>
    points.length === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const last = points[points.length - 1];
  const lastFails = last.status === "FAIL";
  const labelEvery = Math.ceil(points.length / 6);
  const barW = points.length > 8 ? 22 : 42;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly trend">
        {/* Bars first so the line reads on top of them. */}
        {points.map((p, i) =>
          p.bar && p.bar.of > 0 && p.bar.value > 0 ? (
            <g key={`bar-${p.weekStart}`}>
              <rect
                x={x(i) - barW / 2}
                y={PAD.top + plotH - (p.bar.value / p.bar.of) * plotH}
                width={barW}
                height={(p.bar.value / p.bar.of) * plotH}
                fill="var(--color-cream-dark)"
              />
              <text
                x={x(i)}
                y={PAD.top + plotH - (p.bar.value / p.bar.of) * plotH - 4}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {p.bar.label}
              </text>
            </g>
          ) : null,
        )}

        {[max, min].map((v) => (
          <text key={v} x={PAD.left - 8} y={y(v) + 3} textAnchor="end" className="fill-muted text-[11px]">
            {formatValue(v, format)}
          </text>
        ))}

        {/* The line only. Its label used to sit above the right-hand end,
            inside the plot, where it collided with whichever bar label
            happened to be there — the callers put the target in the note
            beside the title instead, which has a row to itself. */}
        {target !== null && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(target)}
            y2={y(target)}
            stroke="var(--color-orange-brand)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
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
              <title>
                {`${shortWeek(p.weekStart)} — ${formatValue(p.value, format)}${p.caption ? ` (${p.caption})` : ""}`}
              </title>
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
          {formatValue(last.value, format)}
        </text>
      </svg>

      {/* Never let a short series pass for a full one. */}
      {points.length < requested && (
        <p className="mt-1 text-xs text-muted">
          {points.length} of the last {requested} weeks have data for this series.
        </p>
      )}
    </>
  );
}

/** The action-items block every summary column ends with. */
export function ActionItemsSummary({ items }: { items: ShellActionItems }) {
  const quiet = items.awaiting === 0 && items.monitoring === 0 && items.overdue === 0;
  return (
    <div className="border-t border-line pt-3.5">
      <h6 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">Action items</h6>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
        <strong className="font-mono tabular-nums">{items.open}</strong>
        <span>active</span>
        {items.awaiting > 0 && (
          <>
            <strong className="font-mono text-fail tabular-nums">{items.awaiting}</strong>
            <span className="text-fail">awaiting acknowledgement</span>
          </>
        )}
        {items.overdue > 0 && (
          <>
            <strong className="font-mono text-fail tabular-nums">{items.overdue}</strong>
            <span className="text-fail">overdue</span>
          </>
        )}
        {items.monitoring > 0 && (
          <>
            <strong className="font-mono tabular-nums">{items.monitoring}</strong>
            <span>monitoring</span>
          </>
        )}
        <strong className="font-mono tabular-nums">{items.sustained}</strong>
        <span>sustained</span>
        {/* Three zeros deserve one quiet line, not three rows of nothing. */}
        {quiet && (
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
  );
}
