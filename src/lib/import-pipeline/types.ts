/** Canonical KPI codes produced by the import pipeline. */
export const KPI_CODES = {
  QUALITY: "QUALITY",
  NPS: "NPS",
  ATTENDANCE: "ATTENDANCE",
  CPH: "CPH",
  AHT: "AHT",
  CRITICAL_ERRORS: "CRITICAL_ERRORS",
} as const;

export type KpiCode = (typeof KPI_CODES)[keyof typeof KPI_CODES];

/** One employee as discovered in the source workbook. */
export interface ParsedEmployee {
  eid: string;
  name: string;
  supervisorName?: string;
  supervisorEid?: string;
  managerName?: string;
  site?: string;
  skillType?: string;
}

/** One aggregated metric for one employee in one week. */
export interface AggregatedMetric {
  eid: string;
  kpiCode: KpiCode;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
  actualValue: number;
  /** Target carried in the source data, where the source supplies one (CPH/AHT). */
  targetValue?: number;
  sampleSize: number;
}

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  sheet: string;
  message: string;
  /** Number of source rows affected. */
  count: number;
}

export interface SheetSummary {
  sheet: string;
  rowsRead: number;
  rowsUsed: number;
  rowsSkipped: number;
}

/**
 * Per-skill production for one employee in one week, used for PAR/MBO
 * scoring. Kept separate from AggregatedMetric because the PAR rating is an
 * hours-weighted roll-up across skills rather than a single measured value.
 */
export interface SkillWeek {
  eid: string;
  weekStart: string;
  weekEnd: string;
  skillType: string;
  cases: number;
  /**
   * Productive hours, the denominator of the performance rate itself.
   */
  hours: number;
  /**
   * Hours used to weight this skill in the employee's overall PAR rating.
   *
   * Deliberately a different basis from `hours`: the business scores the
   * rate on productive time but weights each skill by IEX (scheduled)
   * time, matching how the MBO calculation template is built. Falls back
   * to `hours` when the source carries no IEX figure.
   */
  weightHours: number;
  /**
   * Production weight, the numerator for case-rate skills
   * (case rate = production weight / cases). Unused by CPH and AHT skills.
   */
  prodWeight: number;
  /**
   * The employee's own targets from the source row, which take precedence
   * over the skill reference's defaults because the source carries
   * per-employee targets (ramping agents have lower ones).
   *
   * Both units are kept because the two are not interchangeable: a
   * higher-is-better skill is scored in cases per hour, a lower-is-better
   * one in seconds per case. They are exact reciprocals (AHT = 3600/CPH),
   * so using the wrong one silently scores against a target ~70x off.
   */
  cphTarget?: number;
  ahtTarget?: number;
}

/**
 * Quality audit tallies for one employee in one week, split by skill.
 *
 * The split matters for DPO: each record's attribute count is its own
 * skill's, so an employee audited on several skills must not be scored
 * against a single flat attributes value.
 */
export interface QualityWeek {
  eid: string;
  weekStart: string;
  weekEnd: string;
  /** Per-skill tallies, keyed by the skill label as written in the source. */
  bySkill: Record<string, QualitySkillTally>;
}

export interface QualitySkillTally {
  audits: number;
  /** Audits scoring below a perfect result (#<100). */
  imperfect: number;
  markdowns: number;
}

export interface ParseResult {
  employees: ParsedEmployee[];
  metrics: AggregatedMetric[];
  skillWeeks: SkillWeek[];
  qualityWeeks: QualityWeek[];
  issues: ValidationIssue[];
  sheets: SheetSummary[];
  weeks: string[];
  /** Sheets present in the workbook that the pipeline does not consume. */
  unrecognizedSheets: string[];
}
