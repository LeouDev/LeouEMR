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
  hours: number;
  /**
   * The employee's own target from the source row. The source carries
   * per-employee targets (ramping agents have lower ones), so this takes
   * precedence over the skill reference's default target.
   */
  target?: number;
}

/** Quality audit tallies for one employee in one week. */
export interface QualityWeek {
  eid: string;
  weekStart: string;
  weekEnd: string;
  audits: number;
  /** Audits scoring below a perfect result. */
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
