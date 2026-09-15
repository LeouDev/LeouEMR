"use client";

import { useId } from "react";
import { AstronautFigure } from "./astronaut-figure";

/**
 * The header's "astronaut injecting planets" scene, re-hosted in the
 * sidebar's spare height: the same four planets, the same 14s loop and
 * per-planet offsets (fill/pulse N fires at planet N's arrival), turned
 * on their side — the planets stack down the rail and the astronaut walks
 * down beside them, syringe pointing at the column. Purely decorative,
 * `aria-hidden` at the mount site.
 *
 * clipPath ids are suffixed with useId() so two mounts (the rail and the
 * drawer never coexist, but nothing enforces that) can never collide.
 */
export function SidebarScene() {
  const uid = useId();
  const clip = (n: number) => `sidebar-scene-planet-${n}-${uid}`;

  const planets: Array<{ y: number; r: number; ring?: boolean }> = [
    { y: 60, r: 12 },
    { y: 160, r: 9, ring: true },
    { y: 260, r: 11 },
    { y: 360, r: 8 },
  ];

  return (
    <svg viewBox="0 0 200 400" preserveAspectRatio="xMidYMid meet" className="block h-full w-full">
      <g fill="var(--bg)">
        <circle cx={22} cy={18} r={1.4} style={{ animation: "hdr-twinkle 2.4s ease-in-out infinite" }} />
        <circle cx={168} cy={44} r={1} style={{ animation: "hdr-twinkle 3.1s ease-in-out .5s infinite" }} />
        <circle cx={40} cy={110} r={1.6} style={{ animation: "hdr-twinkle 2.7s ease-in-out 1s infinite" }} />
        <circle cx={182} cy={132} r={1.1} style={{ animation: "hdr-twinkle 2.2s ease-in-out .3s infinite" }} />
        <circle cx={16} cy={206} r={1.3} style={{ animation: "hdr-twinkle 3.4s ease-in-out 1.4s infinite" }} />
        <circle cx={160} cy={222} r={1} style={{ animation: "hdr-twinkle 2.9s ease-in-out .8s infinite" }} />
        <circle cx={30} cy={300} r={1.5} style={{ animation: "hdr-twinkle 2.5s ease-in-out .2s infinite" }} />
        <circle cx={186} cy={318} r={1.2} style={{ animation: "hdr-twinkle 3.2s ease-in-out 1.1s infinite" }} />
        <circle cx={150} cy={384} r={1} style={{ animation: "hdr-twinkle 2.6s ease-in-out .6s infinite" }} />
        <circle cx={70} cy={392} r={0.8} style={{ animation: "hdr-twinkle 2.1s ease-in-out 1.8s infinite" }} />
      </g>

      {/* Planets, each: a pulse ring, a navy base, an orange fill that rises
          in from below on injection, then the outline back on top. */}
      {planets.map((planet, index) => {
        const n = index + 1;
        return (
          <g key={n} transform={`translate(112,${planet.y})`}>
            <circle
              r={planet.r}
              fill="none"
              stroke="var(--orange-500)"
              strokeWidth={1}
              className="hdr-pulse-ring"
              style={{ animation: `hdr-pulse${n} 14s linear infinite`, transformOrigin: "0 0" }}
            />
            <circle r={planet.r} fill="var(--navy-600)" />
            <clipPath id={clip(n)}>
              <circle r={planet.r} />
            </clipPath>
            <rect
              x={-12}
              y={-12}
              width={24}
              height={24}
              fill="var(--orange-500)"
              clipPath={`url(#${clip(n)})`}
              style={{ animation: `hdr-fill${n} 14s linear infinite` }}
            />
            <circle r={planet.r} fill="none" stroke="var(--bg)" strokeWidth={1.5} />
            {planet.ring && <ellipse rx={15} ry={3.5} fill="none" stroke="var(--bg)" strokeWidth={1} transform="rotate(-18)" />}
          </g>
        );
      })}

      {/* Astronaut: walks down beside the column, hops in place, and jabs
          sideways into each planet on arrival. Level with the first planet
          to start; sb-travel steps it down by the planet spacing. */}
      <g transform="translate(62,48)">
        <g style={{ animation: "sb-travel 14s cubic-bezier(.5,0,.3,1) infinite" }}>
          <g style={{ animation: "hdr-hop 2.2s ease-in-out infinite" }}>
            <AstronautFigure />
            {/* Arm + syringe, turned to point at the planets: the jab's
                downward nudge becomes a sideways one under the rotation. */}
            <g transform="translate(9,8) rotate(-90)">
              <rect x={0} y={0} width={4} height={9} fill="#eef0f3" />
              <g style={{ animation: "hdr-jab 14s linear infinite" }}>
                <rect x={-1} y={8} width={6} height={12} fill="var(--bg)" stroke="var(--navy-800)" strokeWidth={0.8} />
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
