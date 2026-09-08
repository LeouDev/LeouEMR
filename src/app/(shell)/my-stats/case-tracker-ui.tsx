"use client";

import { useState } from "react";

/**
 * The table and form classes the tracker's cards share, kept in one place so
 * three files cannot drift into three slightly different tables.
 */
export const HEAD = "px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase";
export const CELL = "px-3 py-2 text-sm text-ink";
export const NUM = "px-3 py-2 font-mono text-sm tabular-nums";
export const FIELD =
  "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-orange-brand";
export const LABEL = "block text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase";

/** Two decimal places, the way every other figure in the app is shown. */
export const fmt = (n: number) => n.toFixed(2);

/** Deleting a logged case is not undoable and there is no copy anywhere else. */
export function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => setArmed(true)}
        className="px-2 py-1 text-lg leading-none font-bold text-muted transition hover:text-fail"
      >
        ×
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1.5">
      <button
        type="button"
        onClick={onConfirm}
        className="bg-fail px-2 py-1 text-[11px] font-bold tracking-[0.08em] text-white uppercase"
      >
        Remove
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="px-2 py-1 text-[11px] font-bold tracking-[0.08em] text-muted uppercase"
      >
        Keep
      </button>
    </span>
  );
}
