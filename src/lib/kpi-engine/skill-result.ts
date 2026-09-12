/**
 * A skill as a KPI of its own.
 *
 * Every skill reference has a matching KPI definition (code `SKILL_<skill
 * code>`, seeded by migration 0042 and kept in step by the import), so an
 * agent's week on a skill is evaluated against that skill's target and
 * tracked by the same engine as every other KPI. That is what puts one
 * development item per skill on the development plan — "Gen_Phones" rather
 * than a blended handle-time figure that hides which queue the miss was on.
 *
 * The measurement is the skill's own formula, the one PAR is built from:
 * cases per hour, seconds per case, or production weight per case. A week
 * passes when it meets the target the agent was held to that week — the
 * ramp stage's while ramping, the skill's otherwise.
 */

export const SKILL_KPI_PREFIX = "SKILL_";

export function skillKpiCode(skillCode: string): string {
  return `${SKILL_KPI_PREFIX}${skillCode.toUpperCase()}`;
}

export type SkillMetric = "cph" | "aht" | "case_rate";

export interface SkillWeekTotals {
  cases: number;
  /** Productive hours on the skill. */
  hours: number;
  /** Production weight, the numerator for case-rate skills. */
  prodWeight: number;
}

/**
 * Below this much productive time on a skill, a week is not judged: an hour
 * or less of a queue is not a fair sample of anyone's rate. Case-rate skills
 * involve no hours and are judged on cases instead.
 */
export const MIN_SKILL_HOURS = 1;

/**
 * The measured value for one skill-week, per the skill's configured metric.
 * Case rate is weight-based and involves no hours at all.
 */
export function measureSkill(metric: SkillMetric, skill: SkillWeekTotals): number | null {
  switch (metric) {
    case "aht":
      return skill.cases > 0 ? (skill.hours / skill.cases) * 3600 : null;
    case "case_rate":
      return skill.cases > 0 && skill.prodWeight > 0 ? skill.prodWeight / skill.cases : null;
    case "cph":
    default:
      return skill.hours > 0 ? skill.cases / skill.hours : null;
  }
}

export interface SkillWeekResult {
  actual: number;
  target: number;
}

/**
 * What goes on the skill's weekly row, or null when the week is not worth
 * judging: no target, no cases, or (for the hours-based metrics) less than
 * MIN_SKILL_HOURS on the skill. Pass or fail is decided by the KPI
 * definition's direction against `target`, exactly like a CPH or AHT row
 * carrying a source target.
 */
export function measureSkillWeek(
  metric: SkillMetric,
  skill: SkillWeekTotals,
  target: number | undefined,
): SkillWeekResult | null {
  if (target === undefined || !(target > 0)) return null;
  if (!(skill.cases > 0)) return null;
  if (metric !== "case_rate" && skill.hours < MIN_SKILL_HOURS) return null;
  const actual = measureSkill(metric, skill);
  if (actual === null || !Number.isFinite(actual)) return null;
  return { actual, target };
}

/**
 * Rows folded into one per configured skill, the totals summed.
 *
 * A source file does not always write a skill the same way from one week
 * to the next — "Fax", then "UHCWest Fax" — and the skill configuration
 * maps every spelling and alias to the one reference. Anything that rates
 * or counts skills has to fold such rows before measuring: rated apart, one
 * skill scored twice in the production rate with its volume split between
 * the halves, wrote two results onto its own KPI for the week (the ledger
 * keeps one), and counted as two skills in the MBO tree. The first row's
 * other fields (its targets, its label, its week) stand for the fold; rows
 * no reference answers to come back separately for the caller to report.
 */
export function foldSkillRows<Row extends SkillWeekTotals & { weightHours?: number }, Ref extends { code: string }>(
  rows: readonly Row[],
  resolve: (row: Row) => Ref | undefined,
): { folded: Array<{ ref: Ref; row: Row }>; unmatched: Row[] } {
  const byCode = new Map<string, { ref: Ref; row: Row }>();
  const unmatched: Row[] = [];
  for (const row of rows) {
    const ref = resolve(row);
    if (!ref) {
      unmatched.push(row);
      continue;
    }
    const entry = byCode.get(ref.code);
    if (!entry) {
      byCode.set(ref.code, { ref, row: { ...row } });
      continue;
    }
    entry.row.cases += row.cases;
    entry.row.hours += row.hours;
    entry.row.prodWeight += row.prodWeight;
    if (entry.row.weightHours !== undefined || row.weightHours !== undefined) {
      entry.row.weightHours = (entry.row.weightHours ?? 0) + (row.weightHours ?? 0);
    }
  }
  return { folded: [...byCode.values()], unmatched };
}
