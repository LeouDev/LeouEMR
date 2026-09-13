"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CallTimer, STATUS_STYLES, formatClock, signedClock, type TimerState } from "@/components/call-timer";
import { DEFAULT_SEGMENTS } from "@/lib/time-motion/engine";
import type { TimeMotionStatus } from "@/lib/time-motion/engine";
import { saveTimeMotionStudy } from "../actions";
import { describeActionError } from "@/lib/ui/action-error";

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

/** One past study, collapsed to a scannable row with the segment breakdown underneath. */
function StudyRow({ study }: { study: TimeMotionStudyRecord }) {
  const diff = study.totalActualSeconds - study.totalBaselineSeconds;
  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {formatClock(study.totalActualSeconds)}
          <span className="ml-2 text-xs font-normal text-muted">
            vs {formatClock(study.totalBaselineSeconds)} baseline · {signedClock(diff)}
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
            {s.label} {formatClock(s.actualSeconds)}
          </span>
        ))}
      </div>
      {study.remarks && <p className="mt-2 text-sm text-ink">{study.remarks}</p>}
    </li>
  );
}

/**
 * Times one call on the shared stopwatch, then saves it against the action
 * item with a call reference and remarks.
 */
function LiveTimer({ actionItemId, onSaved }: { actionItemId: string; onSaved: () => void }) {
  // Bumped after a save so the clock remounts clean for the next call.
  const [run, setRun] = useState(0);
  const [timer, setTimer] = useState<TimerState>({ started: false, ended: false, segments: [] });
  const [callReference, setCallReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onTimer(state: TimerState) {
    setTimer(state);
    if (!state.started) {
      setRemarks("");
      setError(null);
    }
  }

  function reset() {
    setRun((r) => r + 1);
    setTimer({ started: false, ended: false, segments: [] });
    setCallReference("");
    setRemarks("");
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await saveTimeMotionStudy({
        actionItemId,
        callReference,
        remarks,
        segments: timer.segments.map((s) => ({
          code: s.code,
          label: s.label,
          baselineSeconds: s.baselineSeconds,
          actualSeconds: Math.round(s.actualSeconds ?? 0),
        })),
      });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSaving(false);
    }
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
            disabled={timer.started}
            value={callReference}
            onChange={(e) => setCallReference(e.target.value)}
            placeholder="e.g. CR-0000123"
            className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60"
          />
        </label>
      </div>

      <CallTimer
        key={run}
        initialSegments={DEFAULT_SEGMENTS.map((s) => ({ code: s.code, label: s.label, baselineSeconds: s.defaultBaselineSeconds }))}
        onChange={onTimer}
      />

      {timer.ended && (
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
