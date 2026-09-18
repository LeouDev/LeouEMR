"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CallTimer, type TimerState } from "@/components/call-timer";
import { applyTimer, filledCount, timerSegmentsOf, type TimeMotionDraft, type TimeMotionSpec } from "@/lib/quality/time-motion";
import { clampToViewport, panelPositionStore, type PanelPosition } from "@/lib/time-motion/panel-position";
import { openPopOut, popOutSupported } from "@/lib/time-motion/pop-out";

/** Browser support never changes during a visit, so there is nothing to listen to. */
const subscribeNothing = () => () => {};

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
 *
 * Dragging still cannot leave the page, though, so on Chromium it also pops
 * out into a real always-on-top window (see pop-out.ts) that can sit on
 * another monitor or over the recording player.
 *
 * The panel's body renders through a portal into one container element
 * that is created once and then MOVED between the page and that window.
 * Both halves of that matter, and each was found by trying the other:
 *
 * Moving a plain React-rendered node keeps the clock running — React
 * happily updates a node in another document — but its buttons go dead.
 * React registers its listeners on the root container, and a subtree that
 * has left that document bubbles its clicks somewhere React is not
 * listening. Popped out, the segments ticked over and "Complete segment"
 * did nothing.
 *
 * Re-pointing a portal at the pop-out document fixes the events, because
 * React registers listeners on a portal's container too — but changing a
 * portal's container remounts its children, which resets a call that is
 * halfway timed.
 *
 * One container, portalled into once and carried across, has neither
 * problem: the listeners are on the container and travel with it, and
 * React never sees the tree move at all.
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
  /** The place in the page the body sits when it is not popped out. */
  const slot = useRef<HTMLDivElement>(null);
  /**
   * The travelling container: one element for the whole life of the panel,
   * held in state rather than a ref so it can be read while rendering the
   * portal that fills it. The initializer is guarded on `document` because
   * this renders on the server first, where there is none — React runs it
   * again on the client as it hydrates, and the portal appears then.
   */
  const [carrier] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [popped, setPopped] = useState<Window | null>(null);
  const [popOutError, setPopOutError] = useState<string | null>(null);

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

  // Constant: a browser either has the API or it does not, so there is
  // nothing to subscribe to — this is only here to read `window` without
  // an effect, so the server renders the same markup the browser does.
  const canPopOut = useSyncExternalStore(subscribeNothing, popOutSupported, () => false);

  /**
   * Brings the body back into the page. Also the pop-out's own close
   * handler, which is why the move happens here and not only in the effect
   * below: `pagehide` fires while that document is still standing, and
   * waiting for a re-render to rescue the carrier would be waiting until
   * after the window it is sitting in has gone.
   */
  function returnHome() {
    if (carrier && slot.current && carrier.parentElement !== slot.current) {
      slot.current.appendChild(carrier);
    }
    setPopped(null);
  }

  async function popOut() {
    setPopOutError(null);
    try {
      const win = await openPopOut();
      // `pagehide` rather than `unload`: it fires while the document is
      // still intact, so the carrier can be brought home before the window
      // takes it down with it.
      win.addEventListener("pagehide", returnHome, { once: true });
      setPopped(win);
    } catch (error) {
      console.error("[time-motion] could not open the pop-out window", error);
      setPopOutError("This browser would not open the pop-out window. The panel stays here.");
    }
  }

  // Where the carrier lives, and the only place that is decided. Runs after
  // the portal has rendered into it, so there is always something to move.
  useEffect(() => {
    const home = popped ? popped.document.body : slot.current;
    if (carrier && home && carrier.parentElement !== home) home.appendChild(carrier);
  }, [popped, carrier]);

  // A pop-out that outlived the page it belongs to would keep a dead clock
  // on screen with nowhere to file it.
  useEffect(() => {
    if (!popped) return;
    const close = () => popped.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [popped]);

  return (
    <>
      {/* While the panel is popped out the chip is the way back to it, since
          opening a hidden panel would do nothing visible. */}
      <button
        type="button"
        onClick={popped ? returnHome : onToggle}
        aria-expanded={popped ? undefined : open}
        className="fixed right-6 bottom-6 z-40 border-2 border-ink bg-ink px-4 py-3 text-xs font-bold tracking-[0.06em] text-white uppercase hover:bg-navy-800"
      >
        Time &amp; Motion · {filled}/{spec.segments.length}
        {running && <span className="ml-2 text-orange-brand">● Running</span>}
        {popped && <span className="ml-2 text-orange-brand">· Bring back</span>}
      </button>

      <aside
        ref={panel}
        hidden={!open || popped !== null}
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
            {canPopOut && (
              <button type="button" onClick={popOut} className="btn-secondary px-2 py-0.5 text-xs">
                Pop out
              </button>
            )}
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
        <p hidden={!popOutError} className="border-b-2 border-fail bg-fail-bg px-5 py-2 text-xs text-fail">
          {popOutError}
        </p>
        {/* The slot stays put whatever happens, so there is always somewhere
            for the carrier to come home to. */}
        <div ref={slot} />
      </aside>

      {carrier !== null &&
        createPortal(
          <div className="flex flex-col gap-4 p-5">
            <p className="text-xs text-muted">
              Which part of the call is driving the handle time, timed against a baseline. Logged alongside the QA
              scoring — not counted toward the score. The clock keeps running while this panel is closed or popped
              out, and the header drags it out of the way.
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
          </div>,
          carrier,
        )}
    </>
  );
}
