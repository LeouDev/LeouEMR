import { formatWeek } from "@/components/ui";
import type { SkillBreakdownRow } from "@/lib/queries/skill-breakdown";

const CELL = "min-w-28 border-l border-line/60 px-3 py-2 font-mono text-sm tabular-nums";
const STICKY = "sticky left-0 z-10 min-w-52 bg-surface px-6 py-2";

/**
 * Each skill is judged against its own target, which is the point of this
 * table — a blended figure cannot say which skill was carrying the average
 * and which was dragging it. Handle time inverts: lower is the good result.
 *
 * A skill with no configured target stays neutral rather than green. Nothing
 * was cleared, so nothing should read as cleared.
 */
function toneFor(
  cell: { actual: number | null; target: number | null },
  lowerIsBetter: boolean,
): string {
  if (cell.actual === null || cell.target === null) return "text-ink";
  const met = lowerIsBetter ? cell.actual <= cell.target : cell.actual >= cell.target;
  return met ? "font-semibold text-pass" : "font-semibold text-fail";
}

const METRIC_LABELS: Record<SkillBreakdownRow["metric"], string> = {
  cph: "Cases/hr",
  aht: "Handle time",
  case_rate: "Case rate",
};

function formatActual(metric: SkillBreakdownRow["metric"], value: number): string {
  if (metric === "aht") return `${Math.round(value)}s`;
  return value.toFixed(2);
}

/**
 * What a blended KPI like Cases Per Hour or Production Rate is actually made
 * of, one skill at a time.
 *
 * A blended weekly figure sums cases and hours across every skill sharing
 * that metric before dividing (see aggregate.ts) — an employee working two
 * "cph" skills the same week gets one indistinguishable number there. This
 * re-derives each skill's own rate straight from skill_facts, which still
 * carries the skill label the blended ledger drops.
 */
export function SkillBreakdownTable({ rows, weeks }: { rows: SkillBreakdownRow[]; weeks: string[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-cream">
            <th className={`${STICKY} border-r border-line bg-cream font-semibold text-ink`}>Skill</th>
            {weeks.map((week) => (
              <th
                key={week}
                className="min-w-28 border-l border-line/60 px-3 py-2.5 font-semibold whitespace-nowrap text-ink"
              >
                {formatWeek(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.skillLabel} className="border-b border-line/70 last:border-0">
              <td className={`${STICKY} border-r border-line font-medium text-ink`}>
                {row.skillLabel}
                <span className="ml-2 text-[11px] font-normal text-muted">
                  {METRIC_LABELS[row.metric]}
                </span>
              </td>
              {weeks.map((week) => {
                const cell = row.cells.get(week);
                if (!cell || cell.actual === null) {
                  return (
                    <td key={week} className={`${CELL} text-muted/50`}>
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={week}
                    className={CELL}
                    title={
                      `${cell.cases} cases over ${cell.hours.toFixed(1)}h` +
                      (cell.target ? ` · target ${formatActual(row.metric, cell.target)}` : "") +
                      (cell.rating !== null ? ` · rating ${cell.rating.toFixed(2)}` : "")
                    }
                  >
                    <span className={toneFor(cell, row.lowerIsBetter)}>
                      {formatActual(row.metric, cell.actual)}
                    </span>
                    <span className="ml-1.5 text-[11px] text-muted">
                      {cell.cases}/{cell.hours.toFixed(1)}h
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
