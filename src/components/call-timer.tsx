"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEEDS,
  computeVarianceStatus,
  elapsedCallMs,
  type PlaybackSpeed,
  type TimeMotionStatus,
} from "@/lib/time-motion/engine";

/**
 * The call stopwatch: one call timed segment by segment against an
 * editable baseline — a restyled port of the standalone LeouDev/Time-Motion
 * tool. The action item's study and the Phone audit's Time & Motion both
 * run this same clock, so a call is timed the same way wherever it is
 * timed; each parent decides what to do with the result.
 *
 * Elapsed time is computed from wall-clock timestamps rather than counted
 * up one tick at a time, so a throttled background tab cannot make a
 * segment read short: the tick only forces a re-render every 250ms, the
 * actual number always comes from `Date.now() - segmentStart`.
 *
 * What it records is CALL time, not desk time. A study is timed against a
 * recording, and an evaluator listening at 2x covers a minute of call in
 * thirty seconds — so every reading is scaled by the playback speed (see
 * `elapsedCallMs`). At 1x the two are the same thing, which is what the
 * clock did before the speed control existed.
 */

export interface TimerSegment {
  code: string;
  label: string;
  baselineSeconds: number;
  /** Seconds once the segment has been completed; null before. */
  actualSeconds: number | null;
}

export interface TimerState {
  started: boolean;
  ended: boolean;
  segments: TimerSegment[];
}

export const STATUS_STYLES: Record<TimeMotionStatus, string> = {
  good: "bg-pass-bg text-pass",
  warn: "bg-warn-bg text-warn",
  bad: "bg-fail-bg text-fail",
};

export const STATUS_LABELS: Record<TimeMotionStatus, string> = {
  good: "On target",
  warn: "Over target",
  bad: "Well over",
};

/** "mm:ss" from seconds. */
export function formatClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "+mm:ss" over baseline, "−mm:ss" under, "mm:ss" for exactly on it. */
export function signedClock(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return `${sign}${formatClock(Math.abs(diff))}`;
}

export function CallTimer({
  initialSegments,
  onChange,
}: {
  initialSegments: ReadonlyArray<{ code: string; label: string; baselineSeconds: number }>;
  /** Fires on every start, hold-free completion, baseline edit and reset, with the whole state. */
  onChange?: (state: TimerState) => void;
}) {
  const [segments, setSegments] = useState<TimerSegment[]>(() =>
    initialSegments.map((s) => ({ code: s.code, label: s.label, baselineSeconds: s.baselineSeconds, actualSeconds: null })),
  );
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [holding, setHolding] = useState(false);
  const [ended, setEnded] = useState(false);
  /**
   * The active segment's elapsed seconds, for display only. Refreshed from an
   * effect and from the event handlers that start/stop the clock — never
   * computed during render, which would mean reading `Date.now()` or a ref
   * while rendering. React treats that as impure: it can run render more than
   * once for the same state, so a value that depends on the wall clock would
   * silently disagree with itself between passes.
   */
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);

  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);

  const segmentStart = useRef(0);
  /** Call milliseconds already counted for this segment, at the speeds they were counted at. */
  const accumulated = useRef(0);

  const started = currentIndex >= 0;

  /** Call milliseconds for the segment running right now. */
  function elapsedNow(): number {
    return holding ? accumulated.current : elapsedCallMs(accumulated.current, Date.now() - segmentStart.current, speed);
  }

  useEffect(() => {
    if (!started || ended) return;
    const tick = () => {
      const ms = holding ? accumulated.current : elapsedCallMs(accumulated.current, Date.now() - segmentStart.current, speed);
      setLiveElapsedSeconds(ms / 1000);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [started, ended, holding, speed]);

  function emit(next: TimerSegment[], nextStarted: boolean, nextEnded: boolean) {
    onChange?.({ started: nextStarted, ended: nextEnded, segments: next });
  }

  function start() {
    accumulated.current = 0;
    segmentStart.current = Date.now();
    setLiveElapsedSeconds(0);
    setHolding(false);
    setCurrentIndex(0);
    emit(segments, true, false);
  }

  function toggleHold() {
    if (!started || ended) return;
    if (!holding) {
      accumulated.current = elapsedCallMs(accumulated.current, Date.now() - segmentStart.current, speed);
      setHolding(true);
    } else {
      segmentStart.current = Date.now();
      setHolding(false);
    }
  }

  /**
   * Changing speed mid-segment banks what has run at the OLD speed before
   * the new one takes effect, exactly as a hold does. Without that, two
   * minutes already timed at 1x would be re-read at 3x the moment the
   * evaluator sped the recording up, and the segment would jump to six.
   *
   * Reads the speed off the button rather than taking it as an argument so
   * that it is the event handler itself, not a closure built during render:
   * the clock's handlers touch `Date.now()`, which React's purity rule only
   * allows where it can see that the call cannot happen while rendering.
   */
  function changeSpeed(event: React.MouseEvent<HTMLButtonElement>) {
    const next = Number(event.currentTarget.dataset.speed) as PlaybackSpeed;
    if (!next || next === speed) return;
    if (started && !ended && !holding) {
      accumulated.current = elapsedCallMs(accumulated.current, Date.now() - segmentStart.current, speed);
      segmentStart.current = Date.now();
    }
    setSpeed(next);
  }

  function completeSegment() {
    if (!started || ended) return;
    const ms = elapsedNow();
    const next = segments.map((s, i) => (i === currentIndex ? { ...s, actualSeconds: ms / 1000 } : s));
    setSegments(next);

    const last = currentIndex >= segments.length - 1;
    if (!last) {
      accumulated.current = 0;
      segmentStart.current = Date.now();
      setLiveElapsedSeconds(0);
      setHolding(false);
      setCurrentIndex(currentIndex + 1);
    } else {
      setEnded(true);
    }
    emit(next, true, last);
  }

  function reset() {
    const next = segments.map((s) => ({ ...s, actualSeconds: null }));
    setCurrentIndex(-1);
    setEnded(false);
    setHolding(false);
    setLiveElapsedSeconds(0);
    accumulated.current = 0;
    segmentStart.current = 0;
    setSegments(next);
    emit(next, false, false);
  }

  function setBaseline(code: string, value: string) {
    const n = Math.max(0, parseInt(value, 10) || 0);
    const next = segments.map((s) => (s.code === code ? { ...s, baselineSeconds: n } : s));
    setSegments(next);
    emit(next, started, ended);
  }

  const totalActual = segments.reduce(
    (sum, s, i) => sum + (i === currentIndex && !ended ? liveElapsedSeconds : (s.actualSeconds ?? 0)),
    0,
  );

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Baseline (seconds per segment)
        </span>
        {/* Bottom-aligned: a label that wraps to two lines in a narrow panel must not push its box out of line with the others. */}
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
          {segments.map((s) => (
            <label key={s.code} className="block">
              <span className="mb-1 block text-[11px] leading-tight text-muted">{s.label}</span>
              <input
                type="number"
                min={0}
                disabled={started}
                value={s.baselineSeconds}
                onChange={(e) => setBaseline(s.code, e.target.value)}
                className="w-full border-2 border-ink bg-surface px-2 py-1 text-center font-mono text-sm text-ink outline-none disabled:opacity-60"
              />
            </label>
          ))}
        </div>
        {!started && (
          <p className="mt-1.5 text-xs text-muted">Adjust before starting — these are the targets.</p>
        )}
      </div>

      {/* Changeable mid-call on purpose: an evaluator speeds through the
          hold music and drops back to 1x for the part they are actually
          listening to. */}
      <div>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Playback speed
        </span>
        <div className="flex flex-wrap border-2 border-ink" role="group" aria-label="Playback speed">
          {PLAYBACK_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={speed === option}
              data-speed={option}
              onClick={changeSpeed}
              className={`flex-1 px-3 py-2 font-mono text-sm font-bold transition ${
                speed === option ? "bg-orange-brand text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
              }`}
            >
              {option}&times;
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {speed === 1
            ? "Times below are call seconds, matching the baselines."
            : `Listening at ${speed}\u00d7 — the times below are still real call seconds, not seconds at your desk.`}
        </p>
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
                <p className="font-mono text-xs text-muted">baseline {formatClock(s.baselineSeconds)}</p>
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
                {formatClock(actual ?? 0)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between border-t-2 border-dashed border-line pt-3">
        <span className="text-sm font-bold text-ink">Total call time</span>
        <span className="font-mono text-xl font-bold text-ink tabular-nums">{formatClock(totalActual)}</span>
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
    </div>
  );
}
