import type { CSSProperties } from "react";

/**
 * The podium's always-on background.
 *
 * Its own module, with no "use client" directive, so both the client
 * scene and the server-rendered loading frame can draw the same sky —
 * neither one importing anything across a boundary it should not.
 */

/** 46 stars, deterministic so the server and the client draw the same sky. */
const STARS = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 173 + (i % 5) * 61) % 1920,
  y: (i * 97 + (i % 7) * 53) % 1080,
  r: 0.6 + (i % 4) * 0.35,
  dur: 2 + (i % 5) * 0.5,
  delay: (i % 9) * 0.31,
}));

const PLANETS = [
  { x: 190, y: 200, r: 44, fill: "var(--navy-600)", dur: 18, delay: 0 },
  { x: 1750, y: 160, r: 30, fill: "var(--navy-500)", dur: 22, delay: 1.4, ring: true },
  { x: 110, y: 840, r: 24, fill: "var(--navy-700)", dur: 15, delay: 2.6 },
  { x: 1830, y: 780, r: 18, fill: "var(--navy-500)", dur: 13, delay: 3.8 },
];

const STREAKS = [
  { y: 90, dur: 4.2, delay: 0, len: 200, tilt: 12 },
  { y: 260, dur: 5.4, delay: 1.6, len: 160, tilt: 9 },
  { y: 60, dur: 4.8, delay: 3.1, len: 180, tilt: 14 },
  { y: 900, dur: 6, delay: 0.8, len: 150, tilt: 7 },
  { y: 480, dur: 5, delay: 2.4, len: 170, tilt: 11 },
  { y: 700, dur: 6.6, delay: 4, len: 140, tilt: 6 },
];

/**
 * The always-on background: starfield, drifting planets and shooting
 * stars.
 *
 * `slice`, never `none`: a stretched viewBox turns every circle here into
 * an ellipse, which is exactly what went wrong the last time this app drew
 * a sky. Circles stay circles and the edges of the frame are cropped
 * instead.
 */
export function Sky() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {PLANETS.map((p, i) => (
        <g key={i} className="pod-loop-drift" style={{ "--dur": `${p.dur}s`, "--d": `${p.delay}s` } as CSSProperties}>
          <g transform={`translate(${p.x},${p.y})`}>
            <circle r={p.r} fill={p.fill} opacity={0.7} />
            <circle r={p.r} fill="none" stroke="var(--orange-500)" strokeWidth={1} opacity={0.25} />
            {p.ring && (
              <g className="pod-loop-spin" style={{ "--dur": "70s" } as CSSProperties}>
                <ellipse rx={p.r * 1.7} ry={p.r * 0.4} fill="none" stroke="var(--bg)" strokeWidth={1} opacity={0.3} />
              </g>
            )}
          </g>
        </g>
      ))}
      {STARS.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="var(--bg)"
          className="pod-loop-twinkle"
          style={{ "--dur": `${s.dur}s`, "--d": `${s.delay}s` } as CSSProperties}
        />
      ))}
      {STREAKS.map((s, i) => (
        <g
          key={i}
          className="pod-loop-shoot"
          style={{ "--dur": `${s.dur}s`, "--d": `${s.delay}s` } as CSSProperties}
        >
          <g transform={`translate(0,${s.y}) rotate(${s.tilt})`}>
            <defs>
              <linearGradient id={`pod-streak-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--bg)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--bg)" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <line x1={-s.len} y1={0} x2={0} y2={0} stroke={`url(#pod-streak-${i})`} strokeWidth={5} strokeLinecap="round" opacity={0.3} />
            <line x1={-s.len} y1={0} x2={0} y2={0} stroke={`url(#pod-streak-${i})`} strokeWidth={2} strokeLinecap="round" />
            <circle r={3} fill="var(--bg)" />
            <circle r={6} fill="var(--orange-400)" opacity={0.35} />
          </g>
        </g>
      ))}
    </svg>
  );
}
