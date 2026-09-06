/**
 * A KPI's evaluation direction determines how `actual` compares to the configured
 * thresholds. See src/lib/kpi-engine/evaluate.ts for the per-direction logic.
 */
export type KpiDirection =
  | "higher_is_better" // e.g. Quality %, NPS, Attendance %
  | "lower_is_better" // e.g. AHT (seconds)
  | "range" // actual must fall within [rangeMin, rangeMax]
  | "boolean_match"; // actual must equal `expected`

export type KpiValueType = "percentage" | "number" | "score" | "boolean";

export type KpiStatus = "PASS" | "WARNING" | "FAIL";

/**
 * A configurable KPI definition. Thresholds are all optional at the type level
 * because which ones are required depends on `direction` (validated at
 * evaluation time, not construction time, since definitions are typically
 * loaded from DB rows).
 */
export interface KpiDefinition {
  code: string;
  name: string;
  type: KpiValueType;
  direction: KpiDirection;
  /** The goal value. Informational for warning-band framing; not required by every direction. */
  target?: number;
  /**
   * For higher_is_better: the actual must reach this to avoid a WARNING (must be >= failureThreshold).
   * For lower_is_better: the actual must stay at/under this to avoid a WARNING (must be <= failureThreshold).
   * Omit to disable the WARNING tier (PASS/FAIL only).
   */
  warningThreshold?: number;
  /**
   * For higher_is_better: FAIL if actual < failureThreshold.
   * For lower_is_better: FAIL if actual > failureThreshold.
   */
  failureThreshold?: number;
  rangeMin?: number;
  rangeMax?: number;
  expected?: boolean;
}

export interface KpiEvaluationResult {
  status: KpiStatus;
  actual: number | boolean;
  target?: number;
}
