import type { ProductivitySkillRow, Scorecard, ScorecardRow } from "@/lib/scorecard/engine";
import { MINIMUM_SCORE } from "@/lib/scorecard/engine";

const HEAD = "px-2 py-2 text-[11px] font-bold tracking-[0.06em] text-white uppercase";
const CELL = "px-2 py-1.5 text-sm";
const NUM = `${CELL} font-mono tabular-nums`;
const BAND = `${CELL} text-xs text-muted`;

/** Percent rows print with two decimals, counts as whole numbers, the rest as given. */
function actualText(row: ScorecardRow): string {
  if (row.actual === null) return "--";
  switch (row.key) {
    case "CRITICAL_ERRORS":
    case "STANDARD_ERRORS":
    case "IRE":
      return row.actual.toFixed(0);
    case "NPS":
      return row.actual.toFixed(2);
    case "PRODUCTIVITY":
      return row.actual.toFixed(2);
    default:
      return `${row.actual.toFixed(2)}%`;
  }
}

function goalText(row: ScorecardRow): string {
  if (row.goal === null) return "";
  switch (row.key) {
    case "CRITICAL_ERRORS":
    case "STANDARD_ERRORS":
    case "IRE":
      return row.goal.toFixed(2);
    case "NPS":
      return row.goal.toFixed(0);
    default:
      return `${row.goal.toFixed(2)}%`;
  }
}

function rateText(rate: number | null, whole: boolean): string {
  if (rate === null) return "--";
  return whole ? rate.toFixed(0) : rate.toFixed(2);
}

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;

function SkillRow({ skill, index }: { skill: ProductivitySkillRow; index: number }) {
  return (
    <tr className="border-b border-line/70">
      <td className={`${CELL} bg-cream/60 whitespace-nowrap text-xs font-semibold text-ink`}>
        Skill {index + 1}
      </td>
      <td className={`${CELL} text-ink`}>
        {skill.name}
        {skill.ramping ? " (Ramp)" : " (Steady)"}
        <span className="ml-1.5 text-[10px] font-bold tracking-[0.06em] text-muted uppercase">{skill.group}</span>
      </td>
      <td className={`${NUM} text-right`}>{skill.attainmentPct === null ? "--" : `${skill.attainmentPct.toFixed(2)}%`}</td>
      <td className={`${NUM} text-right font-semibold`}>{skill.rating === null ? "--" : skill.rating.toFixed(2)}</td>
      <td className={`${NUM} text-right`}>{skill.attainmentPct === null ? "--" : "100.00%"}</td>
      {skill.bandLabels.map((label, i) => (
        <td key={i} className={`${BAND} whitespace-nowrap`}>
          {label}
        </td>
      ))}
      <td className={`${NUM} text-right text-muted`} />
      <td className={`${NUM} text-right bg-cream/60`}>{skill.hours.toFixed(2)}</td>
      <td className={`${NUM} text-right bg-cream/60`}>{pct(skill.share)}</td>
    </tr>
  );
}

function statusNote(row: ScorecardRow): string | null {
  switch (row.status) {
    case "defaulted":
      return "no figure yet — full marks stand in";
    case "no-weight":
      return "no hours on this side";
    case "no-data":
      return "nothing measured — not counted";
    default:
      return null;
  }
}

/**
 * The card as the business's workbook prints it: weightage, metric, actual,
 * rate, goal, the five rate bands, the weighted score, and for productivity
 * the hours and their share.
 */
export function ScorecardTable({ card }: { card: Scorecard }) {
  const productivity = card.rows.find((r) => r.key === "PRODUCTIVITY")!;
  const others = card.rows.filter((r) => r.key !== "PRODUCTIVITY");

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-collapse border-2 border-ink text-sm">
        <thead>
          <tr className="bg-orange-brand">
            <th className={HEAD}>Weightage</th>
            <th className={`${HEAD} text-left`}>Metric</th>
            <th className={`${HEAD} text-right`}>Actual data</th>
            <th className={`${HEAD} text-right`}>Actual rate</th>
            <th className={`${HEAD} text-right`}>Goal</th>
            <th className={HEAD}>Rate 5</th>
            <th className={HEAD}>Rate 4</th>
            <th className={HEAD}>Rate 3</th>
            <th className={HEAD}>Rate 2</th>
            <th className={HEAD}>Rate 1</th>
            <th className={`${HEAD} text-right`}>Weightage score</th>
            <th className={`${HEAD} text-right`}>Prod hours</th>
            <th className={`${HEAD} text-right`}>Weight</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line/70 bg-orange-brand-100/60">
            <td className={`${NUM} text-center font-semibold`} rowSpan={1}>
              {pct(productivity.weight, 0)}
            </td>
            <td className={`${CELL} font-semibold text-ink`} colSpan={9}>
              Productivity
              {productivity.status === "no-data" && (
                <span className="ml-2 text-xs font-normal text-muted">nothing measured — not counted</span>
              )}
            </td>
            <td className={`${NUM} text-right font-semibold`}>
              {productivity.score === null ? "--" : productivity.score.toFixed(2)}
            </td>
            <td className={`${NUM} text-right`}>{(card.hours.phone + card.hours.ancillary).toFixed(2)}</td>
            <td className={`${NUM} text-right`}>{productivity.rate === null ? "--" : productivity.rate.toFixed(2)}</td>
          </tr>
          {(productivity.skills ?? []).map((skill, i) => (
            <SkillRow key={skill.code} skill={skill} index={i} />
          ))}

          {others.map((row) => {
            const note = statusNote(row);
            const dim = row.status === "no-weight" || row.status === "no-data";
            return (
              <tr key={row.key} className={`border-b border-line/70 ${dim ? "text-muted" : ""}`}>
                <td className={`${NUM} text-center font-semibold`}>{pct(row.weight, row.weight * 100 % 1 === 0 ? 0 : 2)}</td>
                <td className={`${CELL} font-semibold ${dim ? "text-muted" : "text-ink"}`}>
                  {row.label}
                  {note && <span className="ml-2 text-xs font-normal text-muted">{note}</span>}
                </td>
                <td className={`${NUM} text-right`}>{dim ? "--" : actualText(row)}</td>
                <td className={`${NUM} text-right font-semibold`}>{dim ? "--" : rateText(row.rate, true)}</td>
                <td className={`${NUM} text-right`}>{goalText(row)}</td>
                {(row.bandLabels ?? ["", "", "", "", ""]).map((label, i) => (
                  <td key={i} className={`${BAND} whitespace-nowrap`}>
                    {label}
                  </td>
                ))}
                <td className={`${NUM} text-right font-semibold`}>{row.score === null ? "--" : row.score.toFixed(2)}</td>
                <td className={NUM} />
                <td className={NUM} />
              </tr>
            );
          })}

          <tr className="border-t-2 border-ink bg-cream">
            <td className={`${NUM} text-center font-bold`}>{pct(card.weightScored, 0)}</td>
            <td className={`${CELL} font-bold text-ink`} colSpan={9}>
              Total weightage
              {card.rescaled && (
                <span className="ml-2 text-xs font-normal text-muted">
                  read over the {pct(card.weightScored, 0)} that could be scored
                </span>
              )}
            </td>
            <td className={`${NUM} text-right font-bold`}>{card.rawScore.toFixed(2)}</td>
            <td className={`${CELL} text-right text-xs font-bold tracking-[0.06em] text-muted uppercase`} colSpan={2}>
              Raw score
            </td>
          </tr>
          <tr className="bg-orange-brand text-white">
            <td className={NUM} />
            <td className={`${CELL} text-right text-xs font-bold tracking-[0.06em] uppercase`} colSpan={9}>
              Final score
            </td>
            <td className={`${NUM} text-right text-base font-extrabold`}>
              {card.finalScore === null ? "--" : card.finalScore.toFixed(2)}
            </td>
            <td className={`${CELL} text-xs font-semibold`} colSpan={2}>
              {card.finalScore === null ? "" : card.finalScore >= MINIMUM_SCORE ? `Meets the ${MINIMUM_SCORE.toFixed(2)} minimum` : `Below the ${MINIMUM_SCORE.toFixed(2)} minimum`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
