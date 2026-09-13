"use client";

import { useState } from "react";
import { CallTimer, type TimerState } from "@/components/call-timer";
import { applyTimer, filledCount, timerSegmentsOf, type TimeMotionDraft, type TimeMotionSpec } from "@/lib/quality/time-motion";

const control = "w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * The Time & Motion side panel: a floating toggle in the corner while the
 * QA steps are scored, and a panel with the same call stopwatch the action
 * item's study uses — start the call, complete each segment as it passes,
 * and the seconds land on the audit. Not part of the score; required in
 * full before the audit can be filed.
 *
 * The panel stays mounted while closed (hidden, not unmounted) so the
 * clock keeps running while the evaluator scores the QA steps.
 */
export function TimeMotionPanel({
  spec,
  draft,
  open,
  onToggle,
  onChange,
}: {
  spec: TimeMotionSpec;
  draft: TimeMotionDraft;
  open: boolean;
  onToggle: () => void;
  onChange: (next: TimeMotionDraft) => void;
}) {
  const filled = filledCount(spec, draft);
  const [running, setRunning] = useState(false);

  function onTimer(state: TimerState) {
    setRunning(state.started && !state.ended);
    onChange(applyTimer(draft, state.segments));
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="fixed right-6 bottom-6 z-40 border-2 border-ink bg-ink px-4 py-3 text-xs font-bold tracking-[0.06em] text-white uppercase hover:bg-navy-800"
      >
        Time &amp; Motion · {filled}/{spec.segments.length}
        {running && <span className="ml-2 text-orange-brand">● Running</span>}
      </button>

      <aside
        hidden={!open}
        role="dialog"
        aria-label="Time and Motion"
        className="fixed top-20 right-6 bottom-20 z-40 w-[520px] max-w-[92vw] overflow-y-auto border-2 border-ink bg-surface shadow-[-4px_4px_0_rgba(0,0,0,0.1)]"
      >
        <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-5 py-3">
          <p className="text-sm font-bold text-ink">Time &amp; Motion</p>
          <button type="button" onClick={onToggle} aria-label="Close" className="btn-secondary px-2 py-0.5 text-sm">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-xs text-muted">
            Which part of the call is driving the handle time, timed against a baseline. Logged alongside the QA
            scoring — not counted toward the score. The clock keeps running while this panel is closed.
          </p>
          <label className="block">
            <span className={label}>Call reference</span>
            <input
              type="text"
              value={draft.callReference}
              maxLength={120}
              placeholder="e.g. CR-0000123"
              onChange={(e) => onChange({ ...draft, callReference: e.target.value })}
              className={control}
            />
          </label>
          <CallTimer initialSegments={timerSegmentsOf(spec, draft)} onChange={onTimer} />
        </div>
      </aside>
    </>
  );
}
