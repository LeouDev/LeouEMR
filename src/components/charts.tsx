import { formatWeek } from "@/components/ui";

/**
 * Small presentational charts drawn as inline SVG.
 *
 * These are read-only summaries for the administrator's analytics view, so
 * they render on the server with no charting dependency and no client
 * JavaScript — the whole page stays a static, printable report.
 */

const NAVY = "var(--color-navy)";
const ORANGE = "var(--color-orange-brand)";

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Colour by how far a fail rate is from acceptable. */
function severity(rate: number): string {
  if (rate >= 40) return "var(--color-fail)";
  if (rate >= 20) return ORANGE;
  return NAVY;
}

/** Colour by how far a pass rate is from acceptable — the inverse of a fail rate's reading, and the same 90% split the MBO stat card above it already uses. */
function passRateSeverity(rate: number): string {
  return rate >= 90 ? "var(--color-pass)" : ORANGE;
}

export function ChartFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="h-full border-2 border-ink bg-surface p-5">
      <h3 className="border-b-2 border-line pb-2.5 text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
        {title}
      </h3>
      {subtitle && <p className="mt-2.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Fail rate over time as an area + line.
 *
 * Weeks are plotted evenly rather than by date: the ledger has one point per
 * reporting week, and even spacing keeps a gap in the data from distorting
 * the slope between the weeks either side of it.
 */
export function TrendChart({
  points,
  grain = "week",
}: {
  points: { week: string; failRate: number; evaluated: number; failing: number }[];
  grain?: "week" | "month";
}) {
  // A month bucket is keyed by its first day; labelling it as a week range
  // would misdescribe the whole month as its opening week.
  const labelFor = (start: string) =>
    grain === "month"
      ? new Date(`${start}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
      : formatWeek(start);
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Only {points.length} {grain}{points.length === 1 ? "" : "s"} in this range — widen the dates
        to plot a trend.
      </p>
    );
  }

  const W = 720;
  const H = 220;
  const PAD = { top: 12, right: 12, bottom: 28, left: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.failRate)) / 10) * 10);

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.failRate)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${PAD.top + plotH} L${x(0)},${PAD.top + plotH} Z`;

  // Label at most eight weeks so the axis stays readable on a dense range.
  const labelEvery = Math.ceil(points.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fail rate by week">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" className="fill-muted text-[9px]">
            {Math.round(max * f)}%
          </text>
        </g>
      ))}

      <path d={area} fill={ORANGE} opacity={0.12} />
      <path d={line} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" />

      {points.map((p, i) => (
        <g key={p.week}>
          <circle cx={x(i)} cy={y(p.failRate)} r={3} fill={ORANGE}>
            {/* A single template string: React renders <title> children as one
                text node and warns on an array. */}
            <title>{`${labelFor(p.week)} — ${percent(p.failRate)} failing (${p.failing} of ${p.evaluated})`}</title>
          </circle>
          {i % labelEvery === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[9px]">
              {labelFor(p.week)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Horizontal bars, sorted by the caller. Used for fail rate by KPI and by group. */
export function BarList({
  rows,
  emptyMessage = "No data in this range.",
  tone = "worse-when-higher",
}: {
  rows: { label: string; value: number; caption?: string }[];
  emptyMessage?: string;
  /** A fail rate reads worse the higher it climbs; a pass rate reads the opposite way. */
  tone?: "worse-when-higher" | "better-when-higher";
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const max = Math.max(...rows.map((r) => r.value), 1);
  const colorFor = tone === "better-when-higher" ? passRateSeverity : severity;

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm text-ink" title={row.label}>
            {row.label}
          </span>
          <span className="font-mono text-sm font-semibold text-ink tabular-nums">
            {percent(row.value)}
          </span>
          <div className="col-span-2 h-1.5 overflow-hidden bg-line">
            <div
              className="h-full"
              style={{
                width: `${(row.value / max) * 100}%`,
                backgroundColor: colorFor(row.value),
              }}
            />
          </div>
          {row.caption && <span className="col-span-2 -mt-0.5 text-xs text-muted">{row.caption}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A ranked leaderboard of people scored on the PAR rating.
 *
 * Deliberately not a BarList: PAR is a 1.00–5.00 rating, not a percentage, so
 * it neither reads as "%" nor scales from zero. The bar spans the rating scale
 * itself — a 1.00 is empty and a 5.00 is full — because scaling from zero would
 * squeeze every real rating into the top of the bar and make them look alike.
 */
export function RankList({
  rows,
  min = 1,
  max = 5,
  target = 3,
  emptyMessage = "No data in this range.",
}: {
  rows: { label: string; value: number; caption?: string; href?: string }[];
  min?: number;
  max?: number;
  /** At or above this the rating counts as meeting expectations. */
  target?: number;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-2.5">
      {rows.map((row, i) => {
        const tone = row.value >= target ? "var(--color-pass)" : ORANGE;
        const fill = Math.max(0, Math.min(100, ((row.value - min) / (max - min)) * 100));
        return (
          <li key={`${row.label}-${i}`} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-muted tabular-nums">{i + 1}</span>
            <span className="truncate text-sm text-ink" title={row.label}>
              {row.href ? (
                <a href={row.href} className="hover:text-orange-brand hover:underline">
                  {row.label}
                </a>
              ) : (
                row.label
              )}
            </span>
            <span
              className="font-mono text-sm font-semibold tabular-nums"
              style={{ color: tone }}
            >
              {row.value.toFixed(2)}
            </span>
            <div className="col-start-2 col-span-2 h-1.5 overflow-hidden bg-line">
              <div className="h-full" style={{ width: `${fill}%`, backgroundColor: tone }} />
            </div>
            {row.caption && (
              <span className="col-start-2 col-span-2 -mt-0.5 text-xs text-muted">{row.caption}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A single MBO attainment reading as a horizontal gauge. */
export function MboGauge({ value, target = 100 }: { value: number | null; target?: number }) {
  if (value === null) {
    return <span className="text-xs text-muted">No score</span>;
  }

  const pct = Math.max(0, Math.min(100, (value / target) * 100));
  const tone = value >= target ? "var(--color-pass)" : value >= 66 ? ORANGE : "var(--color-fail)";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden bg-line">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: tone }} />
      </div>
      <span className="w-12 text-right font-mono text-xs font-semibold tabular-nums" style={{ color: tone }}>
        {percent(value)}
      </span>
    </div>
  );
}

/** Action-item statuses as proportional segments of one bar. */
export function StatusBar({ rows }: { rows: { status: string; count: number; label: string }[] }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-muted">No action items yet.</p>;
  }

  const tone: Record<string, string> = {
    OPEN: "var(--color-fail)",
    AWAITING_AGENT_ACKNOWLEDGEMENT: ORANGE,
    ACKNOWLEDGED: "var(--color-navy)",
    MONITORING: "var(--color-navy-800)",
    SUSTAINED: "var(--color-pass)",
    RESOLVED: "var(--color-pass)",
    REOPENED: "var(--color-fail)",
  };

  return (
    <div>
      <div className="flex h-3 overflow-hidden">
        {rows.map((r) => (
          <div
            key={r.status}
            style={{ width: `${(r.count / total) * 100}%`, backgroundColor: tone[r.status] ?? NAVY }}
            title={`${r.label}: ${r.count}`}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0"
              style={{ backgroundColor: tone[r.status] ?? NAVY }}
            />
            <span className="flex-1 truncate text-ink">{r.label}</span>
            <span className="font-mono text-xs font-semibold text-ink tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


/**
 * A palette for series that have no inherent pass/fail meaning — a skill, a
 * supervisor — so each one needs its own stable colour rather than a
 * severity-based one. Repeats past its length rather than throwing, since a
 * caller with more series than colours should still render, just with two
 * series sharing a hue.
 */
const SERIES_COLORS = [
  ORANGE,
  NAVY,
  "var(--color-pass)",
  "var(--color-fail)",
  "var(--color-warn)",
  "var(--color-ink-muted)",
  "var(--color-orange-brand-dark)",
  "var(--color-navy-400)",
];

/**
 * Clustered bars: one group per category (a supervisor), one bar per series
 * within the group (a skill). Used for CPH and AHT across skill, where every
 * supervisor needs to be compared skill-for-skill rather than reduced to one
 * blended number.
 *
 * Scaled off the tallest bar in the WHOLE chart rather than per group, so a
 * bar's height means the same thing wherever it sits — a per-group scale
 * would let two equal values look different depending on which supervisor
 * they belonged to.
 */
export function GroupedBarChart({
  groups,
  series,
  unit = "",
  decimals = 2,
  emptyMessage = "No data in this range.",
  maxValue,
}: {
  /** One entry per category on the x-axis (a supervisor). */
  groups: Array<{ label: string; values: Record<string, number | null> }>;
  /** The series keys plotted within each group (a skill), in legend order. */
  series: Array<{ key: string; label: string }>;
  unit?: string;
  decimals?: number;
  emptyMessage?: string;
  /**
   * Fixes the axis scale instead of letting the largest value in the data
   * set it. A single bad data point (an hours figure near zero inflating a
   * rate to hundreds) otherwise sets the scale for the whole chart and
   * crushes every legitimate value against it — the label above a bar past
   * this cap still shows its real, uncapped value, only the bar's height is
   * clamped at the top of the chart.
   */
  maxValue?: number;
}) {
  const withData = groups.filter((g) => series.some((s) => g.values[s.key] !== null && g.values[s.key] !== undefined));
  if (withData.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const allValues = withData.flatMap((g) => series.map((s) => g.values[s.key]).filter((v): v is number => v !== null && v !== undefined));
  const max = maxValue ?? Math.max(...allValues, 0.01);

  // Bar width still adapts to fit a target size when the data is modest —
  // a chart with a handful of supervisors and skills should not scroll for
  // no reason — but the floor is now 10px instead of the original 6px,
  // which crushed a chart with a few dozen supervisors each carrying a
  // dozen-plus skills down to hairlines no value label could sit on. Past
  // that floor, width is what gives: the chart already scrolls
  // horizontally rather than compressing bars further.
  const target = 900;
  const groupGap = 22;
  const barGap = 3;
  const barW = Math.max(
    10,
    Math.min(26, (target - groupGap * withData.length) / withData.length / series.length - barGap),
  );
  const groupW = barW * series.length + barGap * (series.length - 1);
  // top leaves room for a capped bar's rotated label sitting right at the
  // ceiling — its own value can still run to several digits even though the
  // bar itself is clamped there.
  const PAD = { top: 50, right: 12, bottom: 46, left: 40 };
  const plotW = Math.max(target, groupW * withData.length + groupGap * (withData.length + 1)) - PAD.left - PAD.right;
  const H = 280;
  const plotH = H - PAD.top - PAD.bottom;

  // Square-root scale: on a linear axis, one outlier skill/supervisor pair
  // sets the max and crushes every ordinary value down to a sliver against
  // it — exactly what made this chart unreadable. Square-root gives small
  // values real, visible height while the largest value still reaches the
  // top; gridlines are placed at even pixel intervals and labelled with the
  // value that maps there, rather than the other way around.
  const frac = (v: number) => Math.min(1, Math.sqrt(Math.max(0, v) / max));
  const y = (v: number) => PAD.top + plotH - frac(v) * plotH;
  const colorFor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${plotW + PAD.left + PAD.right} ${H}`}
        className="block"
        // width, not just min-width: an SVG with no explicit width is a
        // plain block box and stretches to fill whatever container it is
        // given, silently overriding every size computed above the moment
        // the container is wider than the chart actually needs to be.
        style={{ width: `${plotW + PAD.left + PAD.right}px` }}
        role="img"
        aria-label="Grouped bar chart"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = PAD.top + plotH * (1 - f);
          const value = max * f * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={gy} y2={gy} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={gy + 3} textAnchor="end" className="fill-muted text-[9px]">
                {value.toFixed(value < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}

        {withData.map((group, gi) => {
          const groupX = PAD.left + groupGap + gi * (groupW + groupGap);
          return (
            <g key={group.label}>
              {series.map((s, si) => {
                const value = group.values[s.key];
                if (value === null || value === undefined) return null;
                const x = groupX + si * (barW + barGap);
                const barY = y(value);
                const cx = x + barW / 2;
                const capped = value > max;
                return (
                  <g key={s.key}>
                    <rect
                      x={x}
                      y={barY}
                      width={barW}
                      height={Math.max(0, PAD.top + plotH - barY)}
                      fill={colorFor(si)}
                    >
                      <title>{`${group.label} — ${s.label}: ${value.toFixed(decimals)}${unit}${capped ? " (off the chart's scale)" : ""}`}</title>
                    </rect>
                    {/* A bar past the axis cap is clamped at the ceiling,
                        same height as a bar genuinely at the max — this
                        small triangle is what tells them apart without
                        reading the label. */}
                    {capped && (
                      <path
                        d={`M${x},${barY} L${cx},${barY - 5} L${x + barW},${barY} Z`}
                        fill="var(--color-fail)"
                      />
                    )}
                    {/* Rotated so a bar only a few pixels wide still has
                        room for its own label — the reason this chart needs
                        one at all is that the bar height alone cannot be
                        read once an outlier sets the scale. Starts a little
                        higher when capped, to clear the triangle above it. */}
                    <text
                      x={cx}
                      y={capped ? barY - 8 : barY - 3}
                      textAnchor="start"
                      transform={`rotate(-90, ${cx}, ${capped ? barY - 8 : barY - 3})`}
                      className={`text-[7px] ${capped ? "fill-fail font-bold" : "fill-ink"}`}
                    >
                      {value.toFixed(decimals)}
                      {capped ? "+" : ""}
                    </text>
                  </g>
                );
              })}
              <text
                x={groupX + groupW / 2}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="fill-muted text-[9px]"
              >
                {group.label.length > 14 ? `${group.label.slice(0, 13)}…` : group.label}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: colorFor(i) }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Several lines on one chart, one per series (a supervisor) — used for a
 * trend that needs comparing across groups rather than showing one line
 * alone. Caps the legend at a sane number and says so rather than silently
 * rendering an unreadable tangle of lines with no way to tell them apart.
 */
export function MultiSeriesTrendChart({
  buckets,
  series,
  unit = "",
  maxSeries = 8,
}: {
  /** X-axis labels, oldest first. */
  buckets: string[];
  /** One line per entry; `values` is parallel to `buckets`, null where that bucket had no data for this series. */
  series: Array<{ key: string; label: string; values: Array<number | null>; total: number }>;
  unit?: string;
  maxSeries?: number;
}) {
  if (buckets.length < 2 || series.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Not enough buckets in this range to plot a trend.
      </p>
    );
  }

  // Busiest series first, so trimming the legend drops the least material
  // ones rather than an arbitrary alphabetical tail.
  const sorted = [...series].sort((a, b) => b.total - a.total);
  const shown = sorted.slice(0, maxSeries);
  const dropped = sorted.length - shown.length;

  const W = 720;
  const H = 260;
  const PAD = { top: 12, right: 12, bottom: 34, left: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const allValues = shown.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(...allValues, 1);

  const x = (i: number) => PAD.left + (i / (buckets.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const colorFor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];
  const labelEvery = Math.ceil(buckets.length / 8);

  return (
    <div>
      {/* Capped rather than filling the container: viewBox scaling means
          stretching to the full width of a wide analytics page stretches
          the height right along with it, growing the whole chart far past
          what 12 buckets and 8 lines need. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[640px]"
        role="img"
        aria-label="Trend by supervisor"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" className="fill-muted text-[9px]">
              {Math.round(max * f)}
            </text>
          </g>
        ))}

        {shown.map((s, si) => {
          // A gap in one series' data breaks the line there rather than
          // drawing a straight edge across a bucket it has nothing to say
          // about — an unimported bucket is not a bucket of zero.
          const segments: string[] = [];
          let current: string | null = null;
          s.values.forEach((v, i) => {
            if (v === null) {
              if (current) segments.push(current);
              current = null;
              return;
            }
            current = current ? `${current} L${x(i)},${y(v)}` : `M${x(i)},${y(v)}`;
          });
          if (current) segments.push(current);

          return (
            <g key={s.key}>
              {segments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={colorFor(si)} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {s.values.map(
                (v, i) =>
                  v !== null && (
                    <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={colorFor(si)}>
                      <title>{`${s.label} — ${buckets[i]}: ${v}${unit}`}</title>
                    </circle>
                  ),
              )}
            </g>
          );
        })}

        {buckets.map(
          (b, i) =>
            i % labelEvery === 0 && (
              <text key={b} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[9px]">
                {b}
              </text>
            ),
        )}
      </svg>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {shown.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: colorFor(i) }} />
            {s.label}
          </li>
        ))}
      </ul>
      {dropped > 0 && (
        <p className="mt-2 text-xs text-muted">
          Showing the {shown.length} busiest of {sorted.length} supervisors — the rest are omitted so the
          chart stays readable.
        </p>
      )}
    </div>
  );
}

/**
 * A single trend line with an area fill and an optional dashed target —
 * built for a percentage read (MBO pass rate over trailing periods) rather
 * than a general-purpose series chart, which is what MultiSeriesTrendChart
 * already is. Fixed 0–100 scale: a rate has a real, known range, and
 * scaling to it keeps the target line's position meaningful rather than
 * shifting with whatever the data happens to span.
 */
export function TrendLineChart({
  buckets,
  values,
  selectedIndex,
  target,
  unit = "%",
  decimals = 1,
  emptyMessage = "Not enough data to plot a trend.",
}: {
  /** X-axis labels, oldest first. */
  buckets: string[];
  /** One value per bucket, oldest first; null where that bucket has no data. */
  values: Array<number | null>;
  /** Which bucket is "the selected period" — gets the orange marker and label. */
  selectedIndex: number;
  /** Optional dashed reference line, on the same 0–100 scale as the values. */
  target?: number;
  unit?: string;
  decimals?: number;
  emptyMessage?: string;
}) {
  const known = values.filter((v): v is number => v !== null).length;
  if (buckets.length < 2 || known < 2) {
    return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const W = 600;
  const H = 220;
  const baseline = 200;
  const top = 40;
  const x0 = 22;
  const step = (W - x0 * 2) / (buckets.length - 1);
  const x = (i: number) => x0 + i * step;
  const y = (v: number) => baseline - (Math.max(0, Math.min(100, v)) / 100) * (baseline - top);

  // Broken into segments at a null, the same way MultiSeriesTrendChart
  // breaks a line rather than drawing a straight edge across a gap — a
  // bucket with no data said nothing, it did not say zero.
  const segments: Array<Array<{ i: number; v: number }>> = [];
  let current: Array<{ i: number; v: number }> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ i, v });
  });
  if (current.length) segments.push(current);

  const targetY = target !== undefined ? y(target) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="Trend">
      <line x1={0} y1={baseline} x2={W} y2={baseline} stroke="var(--color-ink)" strokeWidth={2} />
      {targetY !== null && (
        <line x1={0} y1={targetY} x2={W} y2={targetY} stroke="var(--color-orange-brand)" strokeWidth={2} strokeDasharray="6 5" />
      )}

      {segments.map((seg, si) => {
        const path = seg.map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
        const area = seg.length > 1 ? `${path} L${x(seg[seg.length - 1].i).toFixed(1)} ${baseline} L${x(seg[0].i).toFixed(1)} ${baseline} Z` : "";
        return (
          <g key={si}>
            {area && <path d={area} fill="var(--color-orange-brand-100)" />}
            <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} strokeLinejoin="round" />
          </g>
        );
      })}

      {values.map((v, i) => {
        if (v === null) return null;
        const selected = i === selectedIndex;
        const showValue = selected || i % 3 === 0;
        return (
          <g key={i}>
            <rect x={x(i) - 4} y={y(v) - 4} width={8} height={8} fill={selected ? "var(--color-orange-brand)" : "var(--color-ink)"}>
              <title>{`${buckets[i]}: ${v.toFixed(decimals)}${unit}`}</title>
            </rect>
            {showValue && (
              <text x={x(i)} y={y(v) - 10} textAnchor="middle" className="fill-ink text-[11px] font-bold">
                {v.toFixed(decimals)}
              </text>
            )}
            <text x={x(i)} y={H - 4} textAnchor="middle" className="fill-muted text-[10px] font-semibold">
              {buckets[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Org totals per trailing bucket, as bars — for a count rather than a rate
 * (critical errors), unlike TrendLineChart's fixed percentage scale.
 */
export function TrendBarChart({
  buckets,
  values,
  selectedIndex,
  emptyMessage = "Not enough data to plot a trend.",
}: {
  /** X-axis labels, oldest first. */
  buckets: string[];
  /** One value per bucket, oldest first. */
  values: number[];
  /** Which bucket is "the selected period" — gets the orange bar. */
  selectedIndex: number;
  emptyMessage?: string;
}) {
  if (buckets.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const W = 600;
  const H = 220;
  const baseline = 200;
  const top = 20;
  const x0 = 22;
  const barW = Math.min(34, (W - x0 * 2) / buckets.length - 6);
  const step = (W - x0 * 2) / buckets.length;
  const max = Math.max(...values, 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="Trend">
      <line x1={0} y1={baseline} x2={W} y2={baseline} stroke="var(--color-ink)" strokeWidth={2} />
      {values.map((v, i) => {
        const h = (v / max) * (baseline - top);
        const cx = x0 + i * step + step / 2;
        const barX = cx - barW / 2;
        const barY = baseline - h;
        const selected = i === selectedIndex;
        return (
          <g key={i}>
            <rect x={barX} y={barY} width={barW} height={h} fill={selected ? "var(--color-orange-brand)" : "var(--color-navy-600)"}>
              <title>{`${buckets[i]}: ${v}`}</title>
            </rect>
            <text x={cx} y={barY - 6} textAnchor="middle" className="fill-ink text-[11px] font-bold">
              {v}
            </text>
            <text x={cx} y={H - 4} textAnchor="middle" className="fill-muted text-[10px] font-semibold">
              {buckets[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
