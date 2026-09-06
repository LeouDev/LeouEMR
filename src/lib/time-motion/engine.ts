/**
 * Time & Motion scoring, ported from the standalone LeouDev/Time-Motion
 * tool (its `variance()` function).
 *
 * The behavior is preserved exactly, the same as src/lib/ews/engine.ts: at or
 * under baseline is good; over baseline by up to 15% is a warning; anything
 * further over is bad. What changes is that a study is a persisted record
 * tied to an action item rather than a one-off page whose only output is an
 * email or a clipboard copy.
 */

export type TimeMotionStatus = "good" | "warn" | "bad";

/** The call-flow phases the reference tool measures, in order, with its default baselines. */
export const DEFAULT_SEGMENTS = [
  { code: "opening", label: "Opening & Verification", defaultBaselineSeconds: 30 },
  { code: "concern", label: "Identify the Concern", defaultBaselineSeconds: 45 },
  { code: "investigation", label: "Investigation", defaultBaselineSeconds: 120 },
  { code: "delivery", label: "Delivery of Findings", defaultBaselineSeconds: 75 },
  { code: "closing", label: "Closing", defaultBaselineSeconds: 30 },
] as const;

export interface TimeMotionSegmentResult {
  code: string;
  label: string;
  baselineSeconds: number;
  actualSeconds: number;
  status: TimeMotionStatus;
}

/**
 * At or under baseline is good. Over baseline, the source tool bands by
 * percentage rather than a flat number of seconds — a 20-second overage on a
 * 30-second opening is a different problem than the same 20 seconds on a
 * 120-second investigation, and a flat threshold would treat them alike.
 */
export function computeVarianceStatus(actualSeconds: number, baselineSeconds: number): TimeMotionStatus {
  const diff = actualSeconds - baselineSeconds;
  if (diff <= 0) return "good";
  const pct = baselineSeconds > 0 ? (diff / baselineSeconds) * 100 : 100;
  return pct <= 15 ? "warn" : "bad";
}

/** Scores a full set of segments and totals them, for persisting one study. */
export function scoreSegments(
  segments: Array<{ code: string; label: string; baselineSeconds: number; actualSeconds: number }>,
): {
  segments: TimeMotionSegmentResult[];
  totalActualSeconds: number;
  totalBaselineSeconds: number;
} {
  const scored = segments.map((s) => ({
    ...s,
    status: computeVarianceStatus(s.actualSeconds, s.baselineSeconds),
  }));
  return {
    segments: scored,
    totalActualSeconds: scored.reduce((sum, s) => sum + s.actualSeconds, 0),
    totalBaselineSeconds: scored.reduce((sum, s) => sum + s.baselineSeconds, 0),
  };
}
