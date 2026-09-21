"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PAD_MAX } from "@/lib/my-space/board";
import { cardViewStore, PAD_CARD, toggled } from "@/lib/my-space/card-view";
import { saveNote } from "./actions";
import { CardChevron } from "./card-chevron";

/**
 * The notepad: one running page beside the four boxes.
 *
 * Not a fifth box. The boxes are lists of items with something to complete,
 * snapshotted and cleared when the day is saved; this is free text that
 * carries on across days, so "Save day" never touches it and it has no place
 * on the progress rail.
 *
 * It saves itself. A notepad you have to remember to save is one people lose
 * work in, so typing schedules a save and stopping performs it. Every save
 * writes the whole page, which is what lets a late save and an early one
 * cross without interleaving half of each.
 */

/**
 * How long the pad waits after the last keystroke before saving.
 *
 * Long enough that ordinary typing is one save rather than thirty — this
 * writes to the database, over a connection whose egress is metered — and
 * short enough that a reader who types a line and looks away has already
 * been saved by the time they look back.
 */
export const SAVE_AFTER_MS = 1200;

type Status = "clean" | "typing" | "saving" | "saved" | "failed";

const STATUS_TEXT: Record<Status, string> = {
  clean: "",
  typing: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  failed: "Could not save — your text is still here",
};

export function Notepad({ initial }: { initial: string | null }) {
  // null means the pad could not be read at all — the table arrives with
  // migration 0059, and the code deploys first. Read once into state: after
  // that the writer owns what is in the box.
  const unavailable = initial === null;
  const [text, setText] = useState(initial ?? "");
  const [status, setStatus] = useState<Status>("clean");
  const timer = useRef<number | null>(null);
  // What the server is known to hold, so a save is skipped when nothing has
  // actually changed — blurring an untouched pad should not write.
  const saved = useRef(initial ?? "");
  // The newest text, for the handlers that run long after the render that
  // registered them and would otherwise save a stale page.
  const latest = useRef(text);

  useEffect(() => {
    latest.current = text;
  }, [text]);

  const commit = useCallback(async (next: string) => {
    if (next === saved.current) return;
    setStatus("saving");
    try {
      const result = await saveNote({ text: next });
      if (result.ok) {
        saved.current = next;
        setStatus("saved");
      } else {
        setStatus("failed");
      }
    } catch {
      setStatus("failed");
    }
  }, []);

  // A pad left mid-sentence when the tab is hidden would otherwise lose
  // whatever was typed inside the last window. Saving on the way out costs
  // one write and covers switching tabs, locking the screen, and most ways
  // of closing a page.
  useEffect(() => {
    function flush() {
      if (document.visibilityState === "hidden") void commit(latest.current);
    }
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [commit]);

  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, []);

  function change(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setText(next);
    setStatus("typing");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void commit(next), SAVE_AFTER_MS);
  }

  function blur() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    void commit(latest.current);
  }

  const collapsedCards = useSyncExternalStore(
    cardViewStore.subscribe,
    cardViewStore.read,
    cardViewStore.serverRead,
  );
  const collapsed = collapsedCards.includes(PAD_CARD);

  // Folding the pad unmounts the box it was being typed into, and a pending
  // save would go with it. The scheduled one is cancelled and performed now
  // instead, so the last thing typed is on its way before the text leaves
  // the screen. Unchanged text is a no-op inside commit.
  function fold() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!collapsed) void commit(latest.current);
    cardViewStore.save(toggled(collapsedCards, PAD_CARD));
  }

  const remaining = PAD_MAX - text.length;

  return (
    <section className="flex flex-col border-2 border-ink bg-surface md:col-span-2" aria-label="Notepad">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={fold}
        className="flex w-full items-center justify-between gap-2.5 border-b-2 border-ink px-5 py-4 text-left transition hover:bg-cream"
      >
        <span className="flex items-center gap-2.5">
          <PadIcon />
          <span className="block">
            <span className="block text-[15px] font-bold text-ink">Notepad</span>
            <span className="mt-0.5 block text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {/* Said plainly, because it is the one card on this page that
                  "Save day" does not clear. */}
              Yours, kept across days
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span
            aria-live="polite"
            className={`text-[11px] font-semibold tracking-[0.08em] uppercase ${
              status === "failed" ? "text-fail" : "text-muted"
            }`}
          >
            {STATUS_TEXT[status]}
          </span>
          <CardChevron open={!collapsed} />
        </span>
      </button>

      {collapsed ? null : unavailable ? (
        <p className="px-5 py-6 text-sm text-muted">
          The notepad is not available yet. Everything else on this page is unaffected.
        </p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={change}
            onBlur={blur}
            maxLength={PAD_MAX}
            rows={10}
            placeholder="Anything you like — it saves itself."
            className="w-full flex-1 resize-y bg-surface px-5 py-4 text-sm leading-relaxed text-ink outline-none placeholder:text-muted"
          />
          {/* Only close to the ceiling: a count on an empty pad is noise. */}
          {remaining <= 500 && (
            <p className="px-5 pb-3 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {remaining} characters left
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      aria-hidden="true"
      className="shrink-0 text-ink"
    >
      <path d="M5 3h14v18H5z" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="var(--orange-500)" />
    </svg>
  );
}
