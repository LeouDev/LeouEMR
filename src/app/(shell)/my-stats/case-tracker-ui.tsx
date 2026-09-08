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

export type GaugeTone = "pass" | "warn" | "fail" | "muted";

const GAUGE_STROKE: Record<GaugeTone, string> = {
  pass: "var(--color-pass)",
  warn: "var(--color-warn)",
  fail: "var(--color-fail)",
  muted: "var(--color-ink-faint)",
};

/**
 * A half-circle progress ring, for a stat that has a natural 0–100% reading
 * (today's cases against today's target) but does not need a full circle —
 * the flat baseline reads as a gauge, not a pie, which fits a number that is
 * a rate rather than a share of a whole.
 *
 * Drawn as one static arc plus one arc whose dash offset is animated, rather
 * than a library: the shape is fixed and this is the only place it is used.
 */
export function HalfDonutGauge({
  percent,
  tone,
  value,
  caption,
}: {
  /** 0–100; the caller clamps, this just draws whatever it is given. */
  percent: number;
  tone: GaugeTone;
  /** The big central figure, e.g. "18/29" or "—". */
  value: string;
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 50;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center" role="img" aria-label={`${value}${caption ? `, ${caption}` : ""}`}>
      <svg viewBox="0 0 120 68" className="w-36" aria-hidden="true">
        <path
          d="M10,60 A50,50 0 0 1 110,60"
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M10,60 A50,50 0 0 1 110,60"
          fill="none"
          stroke={GAUGE_STROKE[tone]}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 300ms" }}
        />
        <text x="60" y="46" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--color-ink)">
          {value}
        </text>
      </svg>
      {caption && (
        <p className="-mt-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{caption}</p>
      )}
    </div>
  );
}

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
