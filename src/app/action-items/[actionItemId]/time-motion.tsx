"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SEGMENTS, computeVarianceStatus } from "@/lib/time-motion/engine";
import type { TimeMotionStatus } from "@/lib/time-motion/engine";
import { saveTimeMotionStudy } from "../actions";

export interface TimeMotionSegmentRecord {
  code: string;
  label: string;
  baselineSeconds: number;
  actualSeconds: number;
  status: TimeMotionStatus;
}

export interface TimeMotionStudyRecord {
  id: string;
  callReference: string | null;
  segments: TimeMotionSegmentRecord[];
  totalActualSeconds: number;
  totalBaselineSeconds: number;
  remarks: string | null;
  createdAt: Date;
}

const STATUS_STYLES: Record<TimeMotionStatus, string> = {
  good: "bg-pass-bg text-pass",
  warn: "bg-warn-bg text-warn",
  bad: "bg-fail-bg text-fail",
};

const STATUS_LABELS: Record<TimeMotionStatus, string> = {
  good: "On target",
  warn: "Over target",
  bad: "Well over",
};

function fmt(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function signedFmt(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return `${sign}${fmt(Math.abs(diff))}`;
}

/** One past study, collapsed to a scannable row with the segment breakdown underneath. */
function StudyRow({ study }: { study: TimeMotionStudyRecord }) {
  const diff = study.totalActualSeconds - study.totalBaselineSeconds;
  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {fmt(study.totalActualSeconds)}
          <span className="ml-2 text-xs font-normal text-muted">
            vs {fmt(study.totalBaselineSeconds)} baseline · {signedFmt(diff)}
          </span>
        </span>
        <span className="text-xs text-muted">
          {study.callReference && <span className="font-mono">{study.callReference} · </span>}
          {study.createdAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {study.segments.map((s) => (
          <span
            key={s.code}
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold ${STATUS_STYLES[s.status]}`}
          >
            {s.label} {fmt(s.actualSeconds)}
          </span>
        ))}
      </div>
      {study.remarks && <p className="mt-2 text-sm text-ink">{study.remarks}</p>}
    </li>
  );
}

interface LiveSegment {
  code: string;
  label: string;
  baselineSeconds: number;
  actualSeconds: number | null;
}

/**
 * Times one call, segment by segment against an editable baseline — a
 * restyled port of the standalone LeouDev/Time-Motion tool's stopwatch.
 *
 * Elapsed time is computed from wall-clock timestamps rather than counted up
 * one tick at a time, so a throttled background tab cannot make a segment
 * read short: `renderTick` only forces a re-render every 250ms, the actual
 * number always comes from `Date.now() - segmentStart`.
 */
function LiveTimer({ actionItemId, onSaved }: { actionItemId: string; onSaved: () => void }) {
  const [segments, setSegments] = useState<LiveSegment[]>(
    DEFAULT_SEGMENTS.map((s) => ({
      code: s.code,
      label: s.label,
      baselineSeconds: s.defaultBaselineSeconds,
      actualSeconds: null,
    })),
  );
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [holding, setHolding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [callReference, setCallReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The active segment's elapsed seconds, for display only. Refreshed from an
   * effect and from the event handlers that start/stop the clock — never
   * computed during render, which would mean reading `Date.now()` or a ref
   * while rendering. React treats that as impure: it can run render more than
   * once for the same state, so a value that depends on the wall clock would
   * silently disagree with itself between passes.
   */
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);

  const segmentStart = useRef(0);
  const accumulated = useRef(0);
  const router = useRouter();

  const started = currentIndex >= 0;

  useEffect(() => {
    if (!started || ended) return;
    const tick = () => {
      const ms = holding ? accumulated.current : accumulated.current + (Date.now() - segmentStart.current);
      setLiveElapsedSeconds(ms / 1000);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [started, ended, holding]);

  function start() {
    accumulated.current = 0;
    segmentStart.current = Date.now();
    setLiveElapsedSeconds(0);
    setHolding(false);
    setCurrentIndex(0);
  }

  function toggleHold() {
    if (!started || ended) return;
    if (!holding) {
      accumulated.current = accumulated.current + (Date.now() - segmentStart.current);
      setHolding(true);
    } else {
      segmentStart.current = Date.now();
      setHolding(false);
    }
  }

  function completeSegment() {
    if (!started || ended) return;
    const ms = holding ? accumulated.current : accumulated.current + (Date.now() - segmentStart.current);
    const actual = ms / 1000;
    setSegments((prev) =>
      prev.map((s, i) => (i === currentIndex ? { ...s, actualSeconds: actual } : s)),
    );

    if (currentIndex < segments.length - 1) {
      accumulated.current = 0;
      segmentStart.current = Date.now();
      setLiveElapsedSeconds(0);
      setHolding(false);
      setCurrentIndex(currentIndex + 1);
    } else {
      setEnded(true);
    }
  }

  function reset() {
    setCurrentIndex(-1);
    setEnded(false);
    setHolding(false);
    setLiveElapsedSeconds(0);
    accumulated.current = 0;
    segmentStart.current = 0;
    setSegments((prev) => prev.map((s) => ({ ...s, actualSeconds: null })));
    setCallReference("");
    setRemarks("");
    setError(null);
  }

  function setBaseline(code: string, value: string) {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setSegments((prev) => prev.map((s) => (s.code === code ? { ...s, baselineSeconds: n } : s)));
  }

  const totalActual = segments.reduce(
    (sum, s, i) => sum + (i === currentIndex && !ended ? liveElapsedSeconds : (s.actualSeconds ?? 0)),
    0,
  );

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveTimeMotionStudy({
      actionItemId,
      callReference,
      remarks,
      segments: segments.map((s) => ({
        code: s.code,
        label: s.label,
        baselineSeconds: s.baselineSeconds,
        actualSeconds: Math.round(s.actualSeconds ?? 0),
      })),
    });
    setSaving(false);
    if (result.ok) {
      reset();
      onSaved();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-4 border-t-2 border-ink px-6 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
            Call reference
          </span>
          <input
            type="text"
            disabled={started}
            value={callReference}
            onChange={(e) => setCallReference(e.target.value)}
            placeholder="e.g. CR-0000123"
            className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60"
          />
        </label>
      </div>

      <div>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Baseline (seconds per segment)
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {segments.map((s) => (
            <label key={s.code} className="block">
              <span className="mb-1 block text-[11px] text-muted">{s.label}</span>
              <input
                type="number"
                min={0}
                disabled={started}
                value={s.baselineSeconds}
                onChange={(e) => setBaseline(s.code, e.target.value)}
                className="w-full border-2 border-ink bg-surface px-2 py-1.5 text-center font-mono text-sm text-ink outline-none disabled:opacity-60"
              />
            </label>
          ))}
        </div>
        {!started && (
          <p className="mt-1.5 text-xs text-muted">Adjust before starting — these are the targets.</p>
        )}
      </div>

      <div className="space-y-2">
        {segments.map((s, i) => {
          const isActive = i === currentIndex && !ended;
          const isDone = i < currentIndex || (i === currentIndex && ended);
          const actual = isDone ? (s.actualSeconds ?? 0) : isActive ? liveElapsedSeconds : null;
          const status = actual !== null ? computeVarianceStatus(actual, s.baselineSeconds) : null;
          return (
            <div
              key={s.code}
              className={`flex items-center gap-4 border-2 px-4 py-3 ${
                isActive ? "border-orange-brand bg-orange-brand-100/30" : "border-line"
              }`}
            >
              <span className="w-6 shrink-0 text-center font-mono text-sm font-bold text-muted">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{s.label}</p>
                <p className="font-mono text-xs text-muted">baseline {fmt(s.baselineSeconds)}</p>
              </div>
              {status && (
                <span className={`shrink-0 px-2 py-1 text-[11px] font-bold uppercase ${STATUS_STYLES[status]}`}>
                  {isActive ? (holding ? "On hold" : "Active") : STATUS_LABELS[status]}
                </span>
              )}
              {!status && <span className="shrink-0 text-[11px] font-bold text-muted uppercase">Pending</span>}
              <span
                className={`w-20 shrink-0 text-right font-mono text-xl font-bold tabular-nums ${
                  isActive ? "text-orange-brand" : "text-ink"
                }`}
              >
                {fmt(actual ?? 0)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between border-t-2 border-dashed border-line pt-3">
        <span className="text-sm font-bold text-ink">Total call time</span>
        <span className="font-mono text-xl font-bold text-ink tabular-nums">{fmt(totalActual)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {!started && (
          <button type="button" onClick={start} className="btn-primary px-5 py-2.5 text-sm">
            Start call
          </button>
        )}
        {started && !ended && (
          <>
            <button
              type="button"
              onClick={toggleHold}
              className="border-2 border-ink px-3 py-2 text-xs font-bold tracking-[0.08em] text-ink uppercase transition hover:bg-orange-brand-100"
            >
              {holding ? "Resume" : "Hold"}
            </button>
            <button type="button" onClick={completeSegment} className="btn-primary px-5 py-2.5 text-sm">
              Complete segment
            </button>
          </>
        )}
        {started && (
          <button
            type="button"
            onClick={reset}
            className="border-2 border-fail px-3 py-2 text-xs font-bold tracking-[0.08em] text-fail uppercase transition hover:bg-fail-bg"
          >
            Reset
          </button>
        )}
      </div>

      {ended && (
        <div className="space-y-3 border-t-2 border-ink pt-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Remarks
            </span>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes on delays, holds, escalations, or anything that affected timing..."
              className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
              {error}
            </p>
          )}
          <button type="button" disabled={saving} onClick={save} className="btn-primary px-5 py-2.5 text-sm">
            {saving ? "Saving…" : "Save study"}
          </button>
        </div>
      )}
    </div>
  );
}

export function TimeMotionSection({
  actionItemId,
  studies,
  canRecord,
}: {
  actionItemId: string;
  studies: TimeMotionStudyRecord[];
  canRecord: boolean;
}) {
  const [showTimer, setShowTimer] = useState(false);

  return (
    <div>
      {studies.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted">
          No study recorded yet. Time a call to see which segment is actually driving the handle
          time overage.
        </p>
      ) : (
        <ul className="divide-y-2 divide-line">
          {studies.map((s) => (
            <StudyRow key={s.id} study={s} />
          ))}
        </ul>
      )}

      {canRecord && !showTimer && (
        <div className="border-t-2 border-ink px-6 py-4">
          <button
            type="button"
            onClick={() => setShowTimer(true)}
            className="btn-secondary px-4 py-2 text-sm"
          >
            Time a call
          </button>
        </div>
      )}

      {canRecord && showTimer && (
        <LiveTimer actionItemId={actionItemId} onSaved={() => setShowTimer(false)} />
      )}
    </div>
  );
}
