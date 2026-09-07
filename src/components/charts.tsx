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
