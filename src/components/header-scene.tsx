"use client";

import { useId } from "react";

/**
 * The header's looping "astronaut injecting planets" scene — lifted from the
 * supplied reference (Header Animation.dc.html) with no redraw: same
 * geometry, same keyframes, same timing. Purely decorative — no props, no
 * state, `aria-hidden` at the mount site — so it can never affect what the
 * header does, only how it looks.
 *
 * clipPath ids are suffixed with useId() so two mounts on one page (there
 * should only ever be one, but nothing enforces that) can never collide and
 * silently clip each other's planets.
 */
export function HeaderScene() {
  const uid = useId();
  const clip = (n: number) => `header-scene-planet-${n}-${uid}`;

  return (
    <svg
      viewBox="0 0 900 66"
      preserveAspectRatio="xMinYMid meet"
      className="h-full w-full"
      style={{ overflow: "visible" }}
    >
      <g fill="var(--bg)">
        <circle cx={20} cy={12} r={1.4} style={{ animation: "hdr-twinkle 2.4s ease-in-out infinite" }} />
        <circle cx={75} cy={50} r={1} style={{ animation: "hdr-twinkle 3.1s ease-in-out .5s infinite" }} />
        <circle cx={140} cy={20} r={1.6} style={{ animation: "hdr-twinkle 2.7s ease-in-out 1s infinite" }} />
        <circle cx={210} cy={56} r={1.1} style={{ animation: "hdr-twinkle 2.2s ease-in-out .3s infinite" }} />
        <circle cx={290} cy={10} r={1.3} style={{ animation: "hdr-twinkle 3.4s ease-in-out 1.4s infinite" }} />
        <circle cx={350} cy={44} r={1} style={{ animation: "hdr-twinkle 2.9s ease-in-out .8s infinite" }} />
        <circle cx={420} cy={16} r={1.5} style={{ animation: "hdr-twinkle 2.5s ease-in-out .2s infinite" }} />
        <circle cx={500} cy={58} r={1.2} style={{ animation: "hdr-twinkle 3.2s ease-in-out 1.1s infinite" }} />
        <circle cx={560} cy={8} r={1} style={{ animation: "hdr-twinkle 2.6s ease-in-out .6s infinite" }} />
        <circle cx={640} cy={40} r={1.4} style={{ animation: "hdr-twinkle 3s ease-in-out 1.6s infinite" }} />
        <circle cx={720} cy={14} r={1.2} style={{ animation: "hdr-twinkle 2.3s ease-in-out .9s infinite" }} />
        <circle cx={790} cy={54} r={1} style={{ animation: "hdr-twinkle 3.3s ease-in-out .4s infinite" }} />
        <circle cx={860} cy={24} r={1.5} style={{ animation: "hdr-twinkle 2.8s ease-in-out 1.3s infinite" }} />
        <circle cx={120} cy={60} r={0.8} style={{ animation: "hdr-twinkle 2.1s ease-in-out 1.8s infinite" }} />
        <circle cx={470} cy={34} r={0.8} style={{ animation: "hdr-twinkle 3.5s ease-in-out .1s infinite" }} />
        <circle cx={680} cy={62} r={0.9} style={{ animation: "hdr-twinkle 2.4s ease-in-out 1.2s infinite" }} />
      </g>

      {/* Planets, each: a pulse ring, a navy base, an orange fill that rises
          in from below on injection, then the outline back on top. */}
      <g transform="translate(60,48)">
        <circle
          r={12}
          fill="none"
          stroke="var(--orange-500)"
          strokeWidth={1}
          className="hdr-pulse-ring"
          style={{ animation: "hdr-pulse1 14s linear infinite", transformOrigin: "0 0" }}
        />
        <circle r={12} fill="var(--navy-600)" />
        <clipPath id={clip(1)}>
          <circle r={12} />
        </clipPath>
        <rect
          x={-12}
          y={-12}
          width={24}
          height={24}
          fill="var(--orange-500)"
          clipPath={`url(#${clip(1)})`}
          style={{ animation: "hdr-fill1 14s linear infinite" }}
        />
        <circle r={12} fill="none" stroke="var(--bg)" strokeWidth={1.5} />
      </g>
      <g transform="translate(290,48)">
        <circle
          r={9}
          fill="none"
          stroke="var(--orange-500)"
          strokeWidth={1}
          className="hdr-pulse-ring"
          style={{ animation: "hdr-pulse2 14s linear infinite", transformOrigin: "0 0" }}
        />
        <circle r={9} fill="var(--navy-600)" />
        <clipPath id={clip(2)}>
          <circle r={9} />
        </clipPath>
        <rect
          x={-12}
          y={-12}
          width={24}
          height={24}
          fill="var(--orange-500)"
          clipPath={`url(#${clip(2)})`}
          style={{ animation: "hdr-fill2 14s linear infinite" }}
        />
        <circle r={9} fill="none" stroke="var(--bg)" strokeWidth={1.5} />
        <ellipse
          rx={15}
          ry={3.5}
          fill="none"
          stroke="var(--bg)"
          strokeWidth={1}
          transform="rotate(-18)"
        />
      </g>
      <g transform="translate(520,48)">
        <circle
          r={11}
          fill="none"
          stroke="var(--orange-500)"
          strokeWidth={1}
          className="hdr-pulse-ring"
          style={{ animation: "hdr-pulse3 14s linear infinite", transformOrigin: "0 0" }}
        />
        <circle r={11} fill="var(--navy-600)" />
        <clipPath id={clip(3)}>
          <circle r={11} />
        </clipPath>
        <rect
          x={-12}
          y={-12}
          width={24}
          height={24}
          fill="var(--orange-500)"
          clipPath={`url(#${clip(3)})`}
          style={{ animation: "hdr-fill3 14s linear infinite" }}
        />
        <circle r={11} fill="none" stroke="var(--bg)" strokeWidth={1.5} />
      </g>
      <g transform="translate(750,48)">
        <circle
          r={8}
          fill="none"
          stroke="var(--orange-500)"
          strokeWidth={1}
          className="hdr-pulse-ring"
          style={{ animation: "hdr-pulse4 14s linear infinite", transformOrigin: "0 0" }}
        />
        <circle r={8} fill="var(--navy-600)" />
        <clipPath id={clip(4)}>
          <circle r={8} />
        </clipPath>
        <rect
          x={-12}
          y={-12}
          width={24}
          height={24}
          fill="var(--orange-500)"
          clipPath={`url(#${clip(4)})`}
          style={{ animation: "hdr-fill4 14s linear infinite" }}
        />
        <circle r={8} fill="none" stroke="var(--bg)" strokeWidth={1.5} />
      </g>

      {/* Astronaut: travels planet to planet, hops in place, jabs downward
          with the syringe on arrival at each one. */}
      <g transform="translate(60,4)">
        <g style={{ animation: "hdr-travel 14s cubic-bezier(.5,0,.3,1) infinite" }}>
          <g style={{ animation: "hdr-hop 2.2s ease-in-out infinite" }}>
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
              <g style={{ animation: "hdr-jab 14s linear infinite" }}>
                <rect
                  x={-1}
                  y={8}
                  width={6}
                  height={12}
                  fill="var(--bg)"
                  stroke="var(--navy-800)"
                  strokeWidth={0.8}
                />
                <rect x={0} y={12} width={4} height={7} fill="var(--orange-500)" />
                <rect x={-2.5} y={6.5} width={9} height={1.5} fill="#c9ced6" />
                <rect x={1.4} y={1} width={1.2} height={6} fill="#c9ced6" />
                <rect x={-2} y={0} width={8} height={1.5} fill="var(--orange-500)" />
                <rect x={1.6} y={20} width={0.8} height={8} fill="var(--bg)" />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
