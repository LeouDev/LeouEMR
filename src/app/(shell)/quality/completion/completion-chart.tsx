import type { LeaderMonth } from "@/lib/quality/completion";
import { weekLabel, type AuditWeek } from "@/lib/quality/week";

/**
 * Audit completion per team leader, one column per week of the month:
 * each leader is a group of four or five bars, the share of that week's
 * required audits their team filed, against a line at 100%. Server-
 * rendered SVG like the rest of the app's charts, so the page stays a
 * static, printable report; every bar carries its figure and its counts
 * in a hover title, and the table under it holds the same numbers.
 *
 * The weeks are an ordered sequence, so they take one hue stepped light
 * to dark rather than four unrelated colours — Week 1 is the palest and
 * the newest week the darkest, and a reader sees the order in the shade.
 * The steps are navy over the surface at fixed strengths, checked as an
 * ordinal ramp (monotone lightness, visible gaps, light end clearing the
 * surface). The target line, not a colour, is what "met" is read against.
 */
const RAMPS: Record<number, readonly string[]> = {
  4: ["#98a5b8", "#6f819b", "#425a7d", "#16335e"],
  5: ["#a2adbf", "#7f8fa6", "#5c708e", "#395276", "#16335e"],
};

function rampFor(count: number): readonly string[] {
  return RAMPS[count] ?? RAMPS[count > 4 ? 5 : 4];
}

export function CompletionChart({ rows, weeks }: { rows: LeaderMonth[]; weeks: AuditWeek[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Nobody on your roster owed an audit this month.</p>;
  }

  const colors = rampFor(weeks.length);
  const barW = 16;
  const barGap = 2;
  const groupW = weeks.length * barW + (weeks.length - 1) * barGap;
  const groupGap = 28;
  const PAD = { top: 30, right: 16, bottom: 58, left: 40 };
  const plotW = Math.max(rows.length * (groupW + groupGap) + groupGap, 280);
  const H = 320;
  const plotH = H - PAD.top - PAD.bottom;
  const W = plotW + PAD.left + PAD.right;
  // The axis runs to a clean number above the tallest bar, never below
  // 100 so the target line is always in view.
  const tallest = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.completionPct ?? 0)));
  const top = Math.max(100, Math.ceil(tallest / 25) * 25);
  const y = (pct: number) => PAD.top + plotH - (Math.min(pct, top) / top) * plotH;
  const baseline = PAD.top + plotH;
  const ticks = Array.from({ length: top / 25 + 1 }, (_, i) => i * 25);

  return (
    <div>
      {/* The legend is the reliable identity channel; the shade only orders it. */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Weeks">
        {weeks.map((week, i) => (
          <li key={week.start} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-3" style={{ background: colors[i] }} />
            <span className="font-semibold text-ink">W{i + 1}</span> {weekLabel(week)}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: `${W}px` }}
          className="block"
          role="img"
          aria-label="Audit completion per team leader by week, percent of required audits filed"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted text-[9px]">
                {tick}%
              </text>
            </g>
          ))}

          {rows.map((row, gi) => {
            const groupX = PAD.left + groupGap + gi * (groupW + groupGap);
            const mid = groupX + groupW / 2;
            return (
              <g key={row.leader}>
                {row.cells.map((cell, wi) => {
                  const x = groupX + wi * (barW + barGap);
                  if (cell.completionPct === null) {
                    // Nothing owed that week: a tick at the baseline, so the
                    // gap reads as "no requirement" rather than a missing bar.
                    return (
                      <line key={wi} x1={x + 3} x2={x + barW - 3} y1={baseline + 3} y2={baseline + 3} stroke="var(--color-line)" strokeWidth={2}>
                        <title>{`${row.leader} — W${wi + 1}: nothing owed`}</title>
                      </line>
                    );
                  }
                  const barY = y(cell.completionPct);
                  const h = Math.max(0, baseline - barY);
                  const r = Math.min(4, h / 2);
                  // Rounded at the data end, square at the baseline.
                  const d =
                    h === 0
                      ? ""
                      : `M${x},${baseline} V${barY + r} Q${x},${barY} ${x + r},${barY} H${x + barW - r} Q${x + barW},${barY} ${x + barW},${barY + r} V${baseline} Z`;
                  const cx = x + barW / 2;
                  return (
                    <g key={wi}>
                      {h > 0 && (
                        <path d={d} fill={colors[wi]}>
                          <title>{`${row.leader} — W${wi + 1} (${weekLabel(cell.week)}): ${cell.completed} of ${cell.required} audits, ${cell.completionPct}%`}</title>
                        </path>
                      )}
                      {/* Rotated so a 16px bar has room for its own figure. */}
                      <text
                        x={cx + 3}
                        y={barY - 4}
                        textAnchor="start"
                        transform={`rotate(-90, ${cx + 3}, ${barY - 4})`}
                        className="fill-ink text-[8px] font-semibold tabular-nums"
                      >
                        {cell.completionPct}%
                      </text>
                    </g>
                  );
                })}
                <text x={mid} y={baseline + 14} textAnchor="middle" className="fill-ink text-[9px]">
                  {leaderLine(row.leader, 0)}
                </text>
                <text x={mid} y={baseline + 25} textAnchor="middle" className="fill-muted text-[9px]">
                  {leaderLine(row.leader, 1)}
                </text>
                <text x={mid} y={baseline + 40} textAnchor="middle" className="fill-muted text-[9px] tabular-nums">
                  {row.completed}/{row.required} · {row.completionPct === null ? "—" : `${row.completionPct}%`}
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
    </div>
  );
}

/**
 * A leader's name on two short lines under the group: the surname before
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
