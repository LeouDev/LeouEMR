"use client";

import { useId } from "react";

/**
 * The Analytics page-band's small decorative scene: three planets already
 * filled, a fourth still being worked while the astronaut hops in place
 * above it — lifted from the supplied reference (Analytics Executive.dc.html)
 * unchanged, re-hosted as its own component the way HeaderScene is.
 *
 * clipPath ids are suffixed with useId() so two mounts can never collide and
 * silently clip each other's planets — the same reasoning HeaderScene notes
 * for the same pattern.
 */
export function AnalyticsScene() {
  const uid = useId();
  const clip = (n: number) => `analytics-scene-planet-${n}-${uid}`;

  return (
    <svg width={300} height={96} viewBox="0 0 300 96" className="block" aria-hidden>
      <circle cx={14} cy={18} r={1.5} fill="var(--bg)" style={{ animation: "ax-twinkle 2.2s ease-in-out infinite" }} />
      <circle cx={120} cy={10} r={1.2} fill="var(--bg)" style={{ animation: "ax-twinkle 3s ease-in-out infinite .6s" }} />
      <circle cx={240} cy={22} r={1.6} fill="var(--bg)" style={{ animation: "ax-twinkle 2.6s ease-in-out infinite 1.1s" }} />
      <circle cx={285} cy={50} r={1.2} fill="var(--bg)" style={{ animation: "ax-twinkle 2s ease-in-out infinite .3s" }} />

      {/* Three already filled — static, nothing left to animate. */}
      <g transform="translate(30,80)">
        <circle r={12} fill="var(--navy-600)" stroke="var(--bg)" strokeWidth={2} />
        <clipPath id={clip(1)}>
          <circle r={12} />
        </clipPath>
        <rect x={-12} y={-12} width={24} height={24} fill="var(--orange-500)" clipPath={`url(#${clip(1)})`} />
      </g>
      <g transform="translate(90,80)">
        <circle r={12} fill="var(--navy-600)" stroke="var(--bg)" strokeWidth={2} />
        <clipPath id={clip(2)}>
          <circle r={12} />
        </clipPath>
        <rect x={-12} y={-12} width={24} height={24} fill="var(--orange-500)" clipPath={`url(#${clip(2)})`} />
      </g>
      <g transform="translate(150,80)">
        <circle r={12} fill="var(--navy-600)" stroke="var(--bg)" strokeWidth={2} />
        <clipPath id={clip(3)}>
          <circle r={12} />
        </clipPath>
        <rect x={-12} y={-12} width={24} height={24} fill="var(--orange-500)" clipPath={`url(#${clip(3)})`} />
      </g>

      {/* The fourth, still filling under the astronaut. */}
      <g transform="translate(210,80)">
        <circle r={12} fill="var(--navy-600)" stroke="var(--bg)" strokeWidth={2} />
        <clipPath id={clip(4)}>
          <circle r={12} />
        </clipPath>
        <g clipPath={`url(#${clip(4)})`}>
          <rect
            x={-12}
            y={-12}
            width={24}
            height={24}
            fill="var(--orange-500)"
            style={{ animation: "ax-fill 6s ease-in-out infinite" }}
          />
        </g>
      </g>

      {/* Astronaut, hopping in place over the planet still being filled. */}
      <g transform="translate(210,42)">
        <g style={{ animation: "ax-hop 1.1s ease-in-out infinite" }}>
          <rect x={-13} y={-2} width={26} height={23} fill="#c9ced6" />
          <rect x={-9} y={-3} width={18} height={17} fill="#eef0f3" />
          <rect x={-9} y={4} width={18} height={1.5} fill="var(--orange-500)" />
          <circle cx={0} cy={-12} r={9.5} fill="#eef0f3" />
          <circle cx={0} cy={-11.5} r={6.5} fill="#1a3c6b" />
          <rect x={-7} y={21} width={5} height={10} fill="#eef0f3" />
          <rect x={2} y={21} width={5} height={10} fill="#eef0f3" />
          <rect x={-7} y={29} width={5} height={3} fill="var(--orange-500)" />
          <rect x={2} y={29} width={5} height={3} fill="var(--orange-500)" />
          <g style={{ animation: "ax-jab 6s ease-in-out infinite" }}>
            <rect x={9} y={4} width={5} height={16} fill="#eef0f3" />
            <rect x={9.5} y={20} width={4} height={12} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1} />
            <rect x={10.5} y={21} width={2} height={10} fill="var(--orange-500)" />
            <line x1={11.5} y1={32} x2={11.5} y2={38} stroke="var(--bg)" strokeWidth={1} />
          </g>
        </g>
      </g>
    </svg>
  );
}
