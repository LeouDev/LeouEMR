import type { KpiDefinition, KpiEvaluationResult } from "./types";

/**
 * Pure KPI evaluator: (actual, definition) -> PASS | WARNING | FAIL.
 *
 * This function knows nothing about employees, weeks, or history — it only
 * classifies a single measured value against a single KPI's configured
 * thresholds. The weekly/historical semantics (4-week sustained rule,
 * action item lifecycle) live in the action-item-engine, which consumes
 * this result but never duplicates its logic.
 */
export function evaluateKpi(
  actual: number | boolean,
  definition: KpiDefinition,
): KpiEvaluationResult {
  switch (definition.direction) {
    case "higher_is_better":
      return evaluateHigherIsBetter(actual as number, definition);
    case "lower_is_better":
      return evaluateLowerIsBetter(actual as number, definition);
    case "range":
      return evaluateRange(actual as number, definition);
    case "boolean_match":
      return evaluateBooleanMatch(actual as boolean, definition);
    default: {
      const exhaustiveCheck: never = definition.direction;
      throw new Error(`Unknown KPI direction: ${exhaustiveCheck}`);
    }
  }
}

function evaluateHigherIsBetter(
  actual: number,
  def: KpiDefinition,
): KpiEvaluationResult {
  if (def.failureThreshold === undefined) {
    throw new Error(
      `KPI "${def.code}": higher_is_better requires failureThreshold`,
    );
  }
  const status: KpiEvaluationResult["status"] =
    actual < def.failureThreshold
      ? "FAIL"
      : def.warningThreshold !== undefined && actual < def.warningThreshold
        ? "WARNING"
        : "PASS";
  return { status, actual, target: def.target };
}

function evaluateLowerIsBetter(
  actual: number,
  def: KpiDefinition,
): KpiEvaluationResult {
  if (def.failureThreshold === undefined) {
    throw new Error(
      `KPI "${def.code}": lower_is_better requires failureThreshold`,
    );
  }
  const status: KpiEvaluationResult["status"] =
    actual > def.failureThreshold
      ? "FAIL"
      : def.warningThreshold !== undefined && actual > def.warningThreshold
        ? "WARNING"
        : "PASS";
  return { status, actual, target: def.target };
}

function evaluateRange(actual: number, def: KpiDefinition): KpiEvaluationResult {
  if (def.rangeMin === undefined || def.rangeMax === undefined) {
    throw new Error(`KPI "${def.code}": range requires rangeMin and rangeMax`);
  }
  const status: KpiEvaluationResult["status"] =
    actual >= def.rangeMin && actual <= def.rangeMax ? "PASS" : "FAIL";
  return { status, actual, target: def.target };
}

function evaluateBooleanMatch(
  actual: boolean,
  def: KpiDefinition,
): KpiEvaluationResult {
  if (def.expected === undefined) {
    throw new Error(`KPI "${def.code}": boolean_match requires expected`);
  }
  return { status: actual === def.expected ? "PASS" : "FAIL", actual };
}

/**
 * Collapses a KPI status to the binary PASS/FAIL input the action-item
 * engine's 4-week rule operates on. WARNING sits above the failure
 * threshold (see evaluateHigherIsBetter/evaluateLowerIsBetter) — it means
 * "met the bar, but only just," not "failed" — so it counts as a pass for
 * issue-tracking purposes.
 */
export function toPassFail(status: KpiEvaluationResult["status"]): "PASS" | "FAIL" {
  return status === "FAIL" ? "FAIL" : "PASS";
}
