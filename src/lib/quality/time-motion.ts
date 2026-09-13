import type { QaDefinition } from "./forms";

/**
 * Time & Motion on a Phone audit: how long each segment of the call took
 * against a baseline the team lead may adjust per audit. Logged alongside
 * the QA scoring, never part of the score, and required in full before
 * an audit with it can be filed.
 */

export interface TimeMotionSegmentSpec {
  label: string;
  /** Default baseline in seconds; the evaluator may override it on each audit. */
  baseline: number;
}

export interface TimeMotionSpec {
  segments: TimeMotionSegmentSpec[];
}

/** As stored on the audit row. */
export interface TimeMotionSegment {
  label: string;
  baselineSeconds: number;
  actualSeconds: number;
}

export interface StoredTimeMotion {
  callReference: string;
  segments: TimeMotionSegment[];
}

/** What the panel edits: raw input strings, so a half-typed number stays as typed. */
export interface TimeMotionDraft {
  callReference: string;
  baselines: Record<string, string>;
  actuals: Record<string, string>;
}

export const MAX_SECONDS = 86_400;

export function timeMotionSpecOf(definition: QaDefinition): TimeMotionSpec | null {
  const spec = definition.timeMotion;
  return spec && spec.segments.length > 0 ? spec : null;
}

export function emptyDraft(): TimeMotionDraft {
  return { callReference: "", baselines: {}, actuals: {} };
}

/** A non-negative number of seconds, or null for blank or nonsense. */
export function parseSeconds(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_SECONDS) return null;
  return Math.round(n);
}

export interface DraftRow {
  label: string;
  baseline: number;
  actual: number | null;
  delta: number | null;
}

export function draftRows(spec: TimeMotionSpec, draft: TimeMotionDraft): DraftRow[] {
  return spec.segments.map((segment) => {
    const baseline = parseSeconds(draft.baselines[segment.label]) ?? segment.baseline;
    const actual = parseSeconds(draft.actuals[segment.label]);
    return { label: segment.label, baseline, actual, delta: actual === null ? null : actual - baseline };
  });
}

export function filledCount(spec: TimeMotionSpec, draft: TimeMotionDraft): number {
  return draftRows(spec, draft).filter((row) => row.actual !== null).length;
}

export function isComplete(spec: TimeMotionSpec, draft: TimeMotionDraft): boolean {
  return filledCount(spec, draft) === spec.segments.length;
}

export function totals(rows: readonly DraftRow[]): { baseline: number; actual: number | null } {
  const filled = rows.filter((row) => row.actual !== null);
  return {
    baseline: rows.reduce((sum, row) => sum + row.baseline, 0),
    actual: filled.length === 0 ? null : filled.reduce((sum, row) => sum + (row.actual ?? 0), 0),
  };
}

/** "+12s", "−5s", "0s"; empty when there is no actual yet. */
export function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  if (delta === 0) return "0s";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`;
}

/** The draft as it will be stored, or null while any segment is still blank. */
export function finalizeDraft(spec: TimeMotionSpec, draft: TimeMotionDraft): StoredTimeMotion | null {
  const rows = draftRows(spec, draft);
  if (rows.some((row) => row.actual === null)) return null;
  return {
    callReference: draft.callReference.trim(),
    segments: rows.map((row) => ({ label: row.label, baselineSeconds: row.baseline, actualSeconds: row.actual ?? 0 })),
  };
}

export const TIME_MOTION_INCOMPLETE = "Complete Time & Motion (all segments) before submitting.";

/**
 * What the server accepts from the page: every segment the form defines,
 * once each, with whole non-negative seconds. Anything else is refused with
 * the same sentence the page shows.
 */
export function validateStoredTimeMotion(spec: TimeMotionSpec, raw: unknown): StoredTimeMotion | { error: string } {
  if (!raw || typeof raw !== "object") return { error: TIME_MOTION_INCOMPLETE };
  const input = raw as { callReference?: unknown; segments?: unknown };
  if (!Array.isArray(input.segments)) return { error: TIME_MOTION_INCOMPLETE };

  const byLabel = new Map<string, { baselineSeconds: number; actualSeconds: number }>();
  for (const entry of input.segments as Array<Record<string, unknown>>) {
    if (!entry || typeof entry.label !== "string") continue;
    const baseline = typeof entry.baselineSeconds === "number" ? entry.baselineSeconds : NaN;
    const actual = typeof entry.actualSeconds === "number" ? entry.actualSeconds : NaN;
    if (![baseline, actual].every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_SECONDS)) {
      return { error: TIME_MOTION_INCOMPLETE };
    }
    byLabel.set(entry.label, { baselineSeconds: Math.round(baseline), actualSeconds: Math.round(actual) });
  }

  const segments: TimeMotionSegment[] = [];
  for (const segment of spec.segments) {
    const found = byLabel.get(segment.label);
    if (!found) return { error: TIME_MOTION_INCOMPLETE };
    segments.push({ label: segment.label, ...found });
  }
  const callReference = typeof input.callReference === "string" ? input.callReference.trim().slice(0, 120) : "";
  return { callReference, segments };
}

/** A stored value read back from the database, narrowed; null for anything malformed. */
export function storedTimeMotionFromRow(raw: unknown): StoredTimeMotion | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { callReference?: unknown; segments?: unknown };
  if (!Array.isArray(value.segments)) return null;
  const segments = (value.segments as Array<Record<string, unknown>>)
    .filter((s) => s && typeof s.label === "string" && typeof s.baselineSeconds === "number" && typeof s.actualSeconds === "number")
    .map((s) => ({ label: s.label as string, baselineSeconds: s.baselineSeconds as number, actualSeconds: s.actualSeconds as number }));
  return { callReference: typeof value.callReference === "string" ? value.callReference : "", segments };
}
