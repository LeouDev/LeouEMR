"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Full-screen loading overlay for sending the end-of-day report: an
 * astronaut hops planet to planet, injecting each one orange, while the
 * report is actually sent in parallel — lifted from the supplied reference
 * (Send EOD Loading.dc.html) with no redraw, same geometry and per-planet
 * timing, just parameterised on `durationMs` instead of a fixed 5s.
 *
 * clipPath ids are suffixed with useId() so two mounts can never collide and
 * silently clip each other's planets — the same reasoning HeaderScene uses
 * for the same pattern.
 *
 * The clip lives on the `<g clipPath>` wrapper around each fill rect, never
 * on the rect itself: the rect is what animates (`transform: translateY`),
 * and a clip-path on a transformed element moves with that transform,
 * which would drag the circular window out of place along with the fill.
 */

const PLANET_LAYOUT = [
  { x: 94, r: 16 },
  { x: 190, r: 12 },
  { x: 286, r: 14 },
  { x: 382, r: 10 },
  { x: 478, r: 15 },
  { x: 574, r: 11 },
  { x: 670, r: 13 },
  { x: 766, r: 9 },
] as const;

/** The three planets with a decorative extra — a ring or a pair of craters. */
function planetExtra(n: number) {
  if (n === 2) {
    return <ellipse rx={20} ry={4.5} fill="none" stroke="var(--bg)" strokeWidth={1.2} transform="rotate(-18)" />;
  }
  if (n === 5) {
    return (
      <>
        <circle cx={-5} cy={-4} r={3} fill="var(--navy-400)" />
        <circle cx={6} cy={5} r={2} fill="var(--navy-400)" />
      </>
    );
  }
  if (n === 7) {
    return <ellipse rx={21} ry={4} fill="none" stroke="var(--bg)" strokeWidth={1.2} transform="rotate(14)" />;
  }
  return null;
}

/** Hand-placed so they read as a composition rather than noise. */
const STARS: Array<[cx: number, cy: number, r: number, dur: number, delay: number]> = [
  [30, 20, 1.6, 2.4, 0],
  [120, 60, 1.1, 3.1, 0.5],
  [230, 18, 1.4, 2.7, 1],
  [330, 200, 1.2, 2.2, 0.3],
  [420, 30, 1.6, 3.4, 1.4],
  [510, 205, 1, 2.9, 0.8],
  [600, 14, 1.5, 2.5, 0.2],
  [700, 60, 1.2, 3.2, 1.1],
  [790, 24, 1.3, 2.6, 0.6],
  [840, 190, 1.4, 3, 1.6],
  [180, 210, 1, 2.3, 0.9],
  [660, 200, 1.1, 3.3, 0.4],
];

export interface EodSendingOverlayProps {
  open: boolean;
  /** Time the astronaut takes to reach the last planet. */
  durationMs?: number;
  /** Status lines, shown roughly two "checks" apart. */
  steps: string[];
  /** Fires durationMs + 250ms after `open` becomes true — once per open. */
  onDone?: () => void;
}

export function EodSendingOverlay({ open, durationMs = 5000, steps, onDone }: EodSendingOverlayProps) {
  const uid = useId();
  const clip = (n: number) => `eod-planet-${n}-${uid}`;
  const [count, setCount] = useState(0);
  // The prop can be a fresh arrow function every render; the timer below
  // should not restart over that, only over `open` actually changing.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!open) return;
    // Counts up from 0 each time this opens — a locally-scoped function
    // invoked here rather than a bare setCount(0) statement, the same shape
    // TimeMotionTracker's own tick() uses for the same reason: this is a
    // fresh subscription starting, not a value React should be computing on
    // its own during render.
    const reset = () => setCount(0);
    reset();
    const tick = window.setInterval(() => setCount((c) => Math.min(c + 1, 8)), durationMs / 8);
    const done = window.setTimeout(() => {
      window.clearInterval(tick);
      onDoneRef.current?.();
    }, durationMs + 250);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [open, durationMs]);

  if (!open) return null;

  const message = steps[Math.min(Math.floor(count / 2), steps.length - 1)];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-800 p-6"
      style={{ animation: "eod-fade-in .3s ease-out", "--eod-dur": `${durationMs}ms` } as CSSProperties}
    >
      <div className="flex w-full max-w-[860px] flex-col gap-7">
        <svg viewBox="0 0 860 220" className="block w-full" style={{ overflow: "visible" }} aria-hidden>
          <g fill="var(--bg)">
            {STARS.map(([cx, cy, r, dur, delay]) => (
              <circle
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r={r}
                style={{ animation: `eod-twinkle ${dur}s ease-in-out ${delay}s infinite` }}
              />
            ))}
          </g>
          <line x1={0} y1={176} x2={860} y2={176} stroke="var(--navy-500)" strokeWidth={2} />

          {PLANET_LAYOUT.map(({ x, r }, i) => {
            const n = i + 1;
            return (
              <g key={n} transform={`translate(${x},150)`}>
                <circle
                  r={r}
                  fill="none"
                  stroke="var(--orange-500)"
                  strokeWidth={1.5}
                  style={{ animation: `eod-r${n} var(--eod-dur) linear forwards`, transformOrigin: "0 0" }}
                />
                <circle r={r} fill="var(--navy-600)" />
                <clipPath id={clip(n)}>
                  <circle r={r} />
                </clipPath>
                <g clipPath={`url(#${clip(n)})`}>
                  <rect
                    x={-16}
                    y={-16}
                    width={32}
                    height={32}
                    fill="var(--orange-500)"
                    className="eod-keep-motion"
                    style={{ animation: `eod-f${n} var(--eod-dur) linear forwards` }}
                  />
                </g>
                <circle r={r} fill="none" stroke="var(--bg)" strokeWidth={2} />
                {planetExtra(n)}
              </g>
            );
          })}

          {/* Astronaut: travels planet to planet, hops in place, jabs
              downward with the syringe on arrival at each one. */}
          <g transform="translate(94,64)">
            <g style={{ animation: "eod-travel var(--eod-dur) cubic-bezier(.5,0,.3,1) forwards" }}>
              <g style={{ animation: "eod-hop 1.1s ease-in-out infinite" }}>
                <g transform="scale(1.5)">
                  <rect x={-9} y={10} width={18} height={16} fill="#eef0f3" />
                  <rect x={-9} y={15} width={18} height={1.5} fill="var(--orange-500)" />
                  <rect x={-11} y={11} width={4} height={10} fill="#c9ced6" />
                  <rect x={-6} y={25} width={5} height={8} fill="#eef0f3" />
                  <rect x={1} y={25} width={5} height={8} fill="#eef0f3" />
                  <rect x={-6} y={31} width={5} height={2} fill="var(--orange-500)" />
                  <rect x={1} y={31} width={5} height={2} fill="var(--orange-500)" />
                  <circle cy={4} r={8} fill="#eef0f3" />
                  <circle cy={4.5} r={5.5} fill="#1a3c6b" />
                  <path
                    d="M-3.5,1.5 q2,-2.5 5.5,-1.5"
                    stroke="var(--bg)"
                    strokeWidth={1.2}
                    fill="none"
                    strokeLinecap="round"
                  />
                  {/* Arm + syringe, pointing down. */}
                  <g transform="translate(9,14)">
                    <rect x={0} y={0} width={4} height={9} fill="#eef0f3" />
                    <g style={{ animation: "eod-jab var(--eod-dur) linear forwards" }}>
                      <rect
                        x={-1}
                        y={8}
                        width={6}
                        height={12}
                        fill="var(--bg)"
                        stroke="var(--navy-800)"
                        strokeWidth={0.8}
                      />
                      <rect
                        x={0}
                        y={9}
                        width={4}
                        height={10}
                        fill="var(--orange-500)"
                        style={{ animation: "eod-drain var(--eod-dur) linear forwards", transformOrigin: "2px 19px" }}
                      />
                      <rect x={-2.5} y={6.5} width={9} height={1.5} fill="#c9ced6" />
                      <rect x={1.4} y={1} width={1.2} height={6} fill="#c9ced6" />
                      <rect x={-2} y={0} width={8} height={1.5} fill="var(--orange-500)" />
                      <rect x={1.6} y={20} width={0.8} height={8} fill="var(--bg)" />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </svg>

        <div className="flex flex-col gap-3.5 text-cream">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
              Sending EOD
            </span>
            <span className="text-[13px] font-semibold text-[#c9ced6]">{count} of 8 checks</span>
          </div>
          <div className="relative h-1.5 bg-navy-500">
            <div
              className="eod-keep-motion absolute inset-0 w-0 bg-orange-brand"
              style={{ animation: "eod-bar var(--eod-dur) linear forwards" }}
            />
          </div>
          <div role="status" aria-live="polite" className="text-[22px] leading-[1.2] font-bold">
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}
