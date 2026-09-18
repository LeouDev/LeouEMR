"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CallTimer, type TimerState } from "@/components/call-timer";
import { applyTimer, filledCount, timerSegmentsOf, type TimeMotionDraft, type TimeMotionSpec } from "@/lib/quality/time-motion";
import { clampToViewport, panelPositionStore, type PanelPosition } from "@/lib/time-motion/panel-position";

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
 *
 * It can also be dragged anywhere on screen by its header. Docked in the
 * right margin it covers the QA form it is meant to be scored alongside,
 * and an evaluator with the recording open in another window needs it
 * somewhere neither one is. Where it is put is remembered per browser, and
 * clamped back into view on every drag and every resize, so it cannot be
 * dragged somewhere it can never be dragged back from.
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
  const panel = useRef<HTMLElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The saved place, read as an external store so the server's docked
  // markup and the browser's first render agree (see panel-position.ts).
  const saved = useSyncExternalStore(
    panelPositionStore.subscribe,
    panelPositionStore.read,
    panelPositionStore.serverRead,
  );

  // A place that fitted a wide monitor can strand the panel when the window
  // shrinks under it, so the saved value is re-clamped rather than trusted.
  useEffect(() => {
    if (!saved) return;
    const onResize = () => {
      const box = panel.current?.getBoundingClientRect();
      if (!box) return;
      const fixed = clampToViewport(saved, box, { width: window.innerWidth, height: window.innerHeight });
      if (fixed.x !== saved.x || fixed.y !== saved.y) panelPositionStore.save(fixed);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [saved]);

  function onTimer(state: TimerState) {
    setRunning(state.started && !state.ended);
    onChange(applyTimer(draft, state.segments));
  }

  function place(clientX: number, clientY: number): PanelPosition | null {
    const box = panel.current?.getBoundingClientRect();
    if (!box || !grab.current) return null;
    return clampToViewport(
      { x: clientX - grab.current.dx, y: clientY - grab.current.dy },
      box,
      { width: window.innerWidth, height: window.innerHeight },
    );
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    // The header carries the close button too; a click on that is not a drag.
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    grab.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = place(event.clientX, event.clientY);
    if (next) panelPositionStore.save(next);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The capture is already gone; nothing to release.
    }
    grab.current = null;
    setDragging(false);
  }

  function dock() {
    panelPositionStore.save(null);
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
        ref={panel}
        hidden={!open}
        role="dialog"
        aria-label="Time and Motion"
        className={`fixed z-40 w-[520px] max-w-[92vw] overflow-y-auto border-2 border-ink bg-surface shadow-[-4px_4px_0_rgba(0,0,0,0.1)] ${
          saved ? "" : "top-20 right-6 bottom-20"
        }`}
        style={
          saved
            ? // Floating: an explicit top means the panel can no longer be
              // stretched between two edges, so it is capped against the
              // bottom of the viewport instead and scrolls inside that.
              { left: saved.x, top: saved.y, maxHeight: `calc(100dvh - ${saved.y + 24}px)` }
            : undefined
        }
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title="Drag to move"
          // Sticky, because the header is the drag handle and the panel
          // scrolls inside itself: scrolled down to the segment list, a
          // non-sticky handle is off the top of its own panel and the thing
          // cannot be moved until you scroll back up to find it.
          className={`sticky top-0 z-10 flex touch-none items-center justify-between gap-2 border-b-2 border-ink bg-surface px-5 py-3 select-none ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <p className="text-sm font-bold text-ink">Time &amp; Motion</p>
          <div className="flex items-center gap-2">
            {saved && (
              <button type="button" onClick={dock} className="btn-secondary px-2 py-0.5 text-xs">
                Dock
              </button>
            )}
            <button type="button" onClick={onToggle} aria-label="Close" className="btn-secondary px-2 py-0.5 text-sm">
              ✕
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-xs text-muted">
            Which part of the call is driving the handle time, timed against a baseline. Logged alongside the QA
            scoring — not counted toward the score. The clock keeps running while this panel is closed, and the
            header drags it out of the way.
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
