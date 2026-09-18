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

/**
 * Playback speeds an evaluator can listen at, since a study is timed
 * against a recording rather than a live call.
 *
 * Whole and half steps to 3x: past that the words stop being intelligible,
 * and the point is to hear the call, not to finish it.
 */
export const PLAYBACK_SPEEDS = [1, 1.5, 2, 2.5, 3] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1;

/**
 * How much of the CALL has passed, from how much of the evaluator's own
 * time has.
 *
 * Multiplied, not divided, and getting that backwards is the whole risk
 * here: a recording played at 2x covers two seconds of call in one second
 * of listening, so thirty seconds at the desk is a minute of call. Timed on
 * the wall clock alone, every segment of a sped-up audit would read short
 * against a baseline written in real call seconds, and a study done at 2x
 * would quietly halve the handle time it exists to measure.
 *
 * `banked` is call milliseconds already counted at whatever speeds were in
 * force when they were counted — a hold, or a change of speed mid-segment,
 * bank what has run so far and restart the clock, so an earlier stretch
 * keeps its own rate rather than being rescaled by the latest one.
 */
export function elapsedCallMs(banked: number, sinceMs: number, speed: number): number {
  return banked + Math.max(0, sinceMs) * speed;
}

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

/**
 * Whether an action item is about handle time, and so carries a time-and-
 * motion study: the standalone AHT KPI, or a skill's own KPI for a skill
 * measured in seconds per case (the lower-is-better skills — OBD Phone,
 * PartD_Phones, Gen_Phones, UHC_west, Clinical Appeals Phone). Critical
 * Errors is lower-is-better too, which is why the skill link is required.
 */
export function isHandleTimeKpi(kpi: {
  code: string;
  direction: string;
  skillReferenceId: string | null;
}): boolean {
  return kpi.code === "AHT" || (kpi.skillReferenceId !== null && kpi.direction === "lower_is_better");
}
