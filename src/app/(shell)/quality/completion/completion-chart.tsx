import type { LeaderCompletion } from "@/lib/quality/completion";

/**
 * Audit completion per team leader as columns: one bar per leader, the
 * share of the week's required audits that were filed, against a line at
 * 100%. Server-rendered SVG like the rest of the app's charts, so the page
 * stays a static, printable report; every bar carries its figure on the
 * cap and its counts in a hover title, and the table under it holds the
 * same numbers for anyone who cannot hover.
 *
 * One hue for every bar: the leaders are categories with no order, and a
 * bar's height already says who is behind. The target line, not a colour,
 * is what "met" is read against.
 */
export function CompletionChart({ rows }: { rows: LeaderCompletion[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Nobody on your roster owed an audit this week.</p>;
  }

  const PAD = { top: 22, right: 16, bottom: 58, left: 40 };
  const slot = 72;
  const barW = 24;
  const plotW = Math.max(slot * rows.length, 240);
  const H = 300;
  const plotH = H - PAD.top - PAD.bottom;
  const W = plotW + PAD.left + PAD.right;
  // The axis runs to a clean number above the tallest bar, and never below
  // 100 so the target line is always in view.
  const top = Math.max(100, Math.ceil(Math.max(...rows.map((r) => r.completionPct)) / 25) * 25);
  const y = (pct: number) => PAD.top + plotH - (Math.min(pct, top) / top) * plotH;
  const baseline = PAD.top + plotH;
  const ticks = Array.from({ length: top / 25 + 1 }, (_, i) => i * 25);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: `${W}px` }}
        className="block"
        role="img"
        aria-label="Audit completion per team leader, percent of required audits filed this week"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted text-[9px]">
              {tick}%
            </text>
          </g>
        ))}

        {rows.map((row, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const barY = y(row.completionPct);
          const h = Math.max(0, baseline - barY);
          const r = Math.min(4, h / 2);
          const cx = x + barW / 2;
          // Rounded at the data end, square at the baseline.
          const d =
            h === 0
              ? ""
              : `M${x},${baseline} V${barY + r} Q${x},${barY} ${x + r},${barY} H${x + barW - r} Q${x + barW},${barY} ${x + barW},${barY + r} V${baseline} Z`;
          return (
            <g key={row.leader}>
              {h > 0 && (
                <path d={d} fill="var(--color-navy)">
                  <title>{`${row.leader}: ${row.completed} of ${row.required} audits (${row.completionPct}%), ${row.activeAgents} active agent${row.activeAgents === 1 ? "" : "s"}`}</title>
                </path>
              )}
              <text x={cx} y={barY - 5} textAnchor="middle" className="fill-ink text-[10px] font-semibold tabular-nums">
                {row.completionPct}%
              </text>
              <text x={cx} y={baseline + 14} textAnchor="middle" className="fill-ink text-[9px]">
                {leaderLine(row.leader, 0)}
              </text>
              <text x={cx} y={baseline + 25} textAnchor="middle" className="fill-muted text-[9px]">
                {leaderLine(row.leader, 1)}
              </text>
              <text x={cx} y={baseline + 40} textAnchor="middle" className="fill-muted text-[9px] tabular-nums">
                {row.completed}/{row.required}
              </text>
            </g>
          );
        })}

        {/* The target: a solid hairline in the accent, labelled once. */}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={y(100)} y2={y(100)} stroke="var(--color-orange-brand)" strokeWidth={1.5} />
        <text x={PAD.left + plotW} y={y(100) - 4} textAnchor="end" className="fill-orange-brand text-[9px] font-semibold">
          Target 100%
        </text>
      </svg>
    </div>
  );
}

/**
 * A leader's name on two short lines under the bar: the surname before
 * the comma on the first, the rest on the second, or the name split at
 * its middle word when it carries no comma.
 */
function leaderLine(name: string, line: 0 | 1): string {
  const comma = name.indexOf(",");
  if (comma > 0) {
    const [first, second] = [name.slice(0, comma).trim(), name.slice(comma + 1).trim()];
    return line === 0 ? first : second;
  }
  const words = name.split(/\s+/);
  if (words.length < 2) return line === 0 ? name : "";
  const cut = Math.ceil(words.length / 2);
  return (line === 0 ? words.slice(0, cut) : words.slice(cut)).join(" ");
}
