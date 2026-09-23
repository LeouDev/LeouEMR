/**
 * The warning signs the weekly data can answer by itself.
 *
 * Three of the ten indicators are read from the imported figures rather
 * than ticked by hand: an absence (attendance under 100% for the week),
 * low productivity (PAR under the MBO gate) and a QA or NPS decline (either
 * lower than the week before). They are derived every time they are read
 * and never stored as a supervisor's judgement, so a tick cannot outlive
 * the figure that earned it. Tardiness stays a judgement: the attendance
 * sheet records present or absent and nothing about minutes late.
 */

export type AutoIndicatorCode = "absent" | "lowprod" | "qadrop";

export const AUTO_INDICATOR_CODES: readonly AutoIndicatorCode[] = ["absent", "lowprod", "qadrop"];

export function isAutoIndicator(code: string): code is AutoIndicatorCode {
  return (AUTO_INDICATOR_CODES as readonly string[]).includes(code);
}

/** The figures behind the three, for one person; null where nothing was measured. */
export interface AutoMetrics {
  attendance: number | null;
  productionRate: number | null;
  quality: number | null;
  previousQuality: number | null;
  nps: number | null;
  previousNps: number | null;
}

export interface AutoIndicator {
  code: AutoIndicatorCode;
  on: boolean;
  /** The figure and the rule, worded for the form's caption. */
  caption: string;
}

export const EMPTY_AUTO_METRICS: AutoMetrics = {
  attendance: null,
  productionRate: null,
  quality: null,
  previousQuality: null,
  nps: null,
  previousNps: null,
};

/** Attendance is present days over scheduled days; anything under all of them is an absence. */
const FULL_ATTENDANCE = 100;

/**
 * The PAR the MBO gate asks for (`productionRate` in the gates of
 * src/lib/import-pipeline/par-scoring.ts). Spelled here rather than
 * imported: this module is read by the forms in the browser, and that one
 * pulls the database client in with it. The test pins the two together.
 */
export const LOW_PAR_BELOW = 2.99;

const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
const num = (value: number, digits: number) => value.toFixed(digits);

export function deriveAutoIndicators(m: AutoMetrics): Record<AutoIndicatorCode, AutoIndicator> {
  const absent = m.attendance !== null && m.attendance < FULL_ATTENDANCE;
  const lowprod = m.productionRate !== null && m.productionRate < LOW_PAR_BELOW;
  const qualityDown = m.quality !== null && m.previousQuality !== null && m.quality < m.previousQuality;
  const npsDown = m.nps !== null && m.previousNps !== null && m.nps < m.previousNps;

  const qaParts: string[] = [];
  if (m.quality !== null) {
    qaParts.push(`QA ${pct(m.quality)}${m.previousQuality !== null ? ` (prev ${pct(m.previousQuality)})` : ""}`);
  }
  if (m.nps !== null) {
    qaParts.push(`NPS ${num(m.nps, 0)}${m.previousNps !== null ? ` (prev ${num(m.previousNps, 0)})` : ""}`);
  }

  return {
    absent: {
      code: "absent",
      on: absent,
      caption:
        m.attendance === null
          ? "No attendance this week"
          : `Attendance ${pct(m.attendance)} (flags below ${FULL_ATTENDANCE}%)`,
    },
    lowprod: {
      code: "lowprod",
      on: lowprod,
      caption:
        m.productionRate === null
          ? "No PAR this week"
          : `PAR ${num(m.productionRate, 2)} (flags below ${LOW_PAR_BELOW})`,
    },
    qadrop: {
      code: "qadrop",
      on: qualityDown || npsDown,
      caption: qaParts.length === 0 ? "No QA or NPS this week" : `${qaParts.join(" · ")} — flags a drop on either`,
    },
  };
}

/** Just the flags, in the shape the score takes. */
export function autoFlags(auto: Record<AutoIndicatorCode, AutoIndicator>): Record<AutoIndicatorCode, boolean> {
  return { absent: auto.absent.on, lowprod: auto.lowprod.on, qadrop: auto.qadrop.on };
}

/** A weekly figure as the period-metrics read returns it; only these fields matter here. */
export interface WeeklyFigure {
  employeeId: string;
  kpiCode: string;
  actualValue: number;
}

const KPI = { attendance: "ATTENDANCE", productionRate: "PRODUCTION_RATE", quality: "QUALITY", nps: "NPS" } as const;

/**
 * Everyone's figures for the data week and the week before it, folded per
 * person. Missing rows stay null, so a week nobody has imported yet
 * flags nobody.
 */
export function autoMetricsByEmployee(
  current: readonly WeeklyFigure[],
  previous: readonly WeeklyFigure[],
): Map<string, AutoMetrics> {
  const out = new Map<string, AutoMetrics>();
  const entry = (id: string) => {
    const e = out.get(id) ?? { ...EMPTY_AUTO_METRICS };
    out.set(id, e);
    return e;
  };
  for (const f of current) {
    const e = entry(f.employeeId);
    if (f.kpiCode === KPI.attendance) e.attendance = f.actualValue;
    else if (f.kpiCode === KPI.productionRate) e.productionRate = f.actualValue;
    else if (f.kpiCode === KPI.quality) e.quality = f.actualValue;
    else if (f.kpiCode === KPI.nps) e.nps = f.actualValue;
  }
  for (const f of previous) {
    const e = entry(f.employeeId);
    if (f.kpiCode === KPI.quality) e.previousQuality = f.actualValue;
    else if (f.kpiCode === KPI.nps) e.previousNps = f.actualValue;
  }
  return out;
}
