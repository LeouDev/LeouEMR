"use client";

import { useId } from "react";
import { AstronautFigure } from "@/components/astronaut-figure";
import { BOXES, BOX_META, PLANET_Y, astronautY, planetOffset, type BoardProgress } from "@/lib/my-space/board";

const STARS: Array<[number, number, number, string]> = [
  [20, 20, 1.3, "2.4s ease-in-out infinite"],
  [140, 70, 1, "3.1s ease-in-out .5s infinite"],
  [24, 200, 1.2, "2.7s ease-in-out 1s infinite"],
  [132, 300, 1, "2.2s ease-in-out .3s infinite"],
  [22, 440, 1.3, "3.4s ease-in-out 1.4s infinite"],
  [136, 530, 1, "2.9s ease-in-out .8s infinite"],
  [30, 610, 1.1, "2.6s ease-in-out .6s infinite"],
];

/**
 * Today's progress as the header's planets, stacked: one per box, filling
 * with orange as that box's percentage climbs, and the astronaut walking
 * the line between them as far as the day's overall figure has come.
 * Decorative around the four percentages, which are also written out.
 */
export function ProgressRail({ progress }: { progress: BoardProgress }) {
  const uid = useId();
  const clip = (box: string) => `my-space-planet-${box}-${uid}`;

  return (
    <aside className="border-2 border-ink bg-navy-800 px-4 py-5" aria-label="Today's progress">
      <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-orange-brand uppercase">Today&apos;s progress</p>
      <svg viewBox="0 0 160 640" className="block w-full" style={{ overflow: "visible" }} role="img" aria-label={`Overall ${progress.overall}% today`}>
        <g fill="var(--bg)">
          {STARS.map(([cx, cy, r, timing]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} style={{ animation: `hdr-twinkle ${timing}` }} />
          ))}
        </g>
        <line x1={80} y1={PLANET_Y.todos} x2={80} y2={PLANET_Y.letgo} stroke="var(--navy-500)" strokeWidth={2} strokeDasharray="4 6" />

        {BOXES.map((box) => (
          <g key={box}>
            <g transform={`translate(80,${PLANET_Y[box]})`}>
              <circle r={34} fill="var(--navy-600)" />
              <clipPath id={clip(box)}>
                <circle r={34} />
              </clipPath>
              <rect
                x={-34}
                y={-34}
                width={68}
                height={68}
                fill="var(--orange-500)"
                clipPath={`url(#${clip(box)})`}
                style={{ transform: `translateY(${planetOffset(progress.byBox[box])}px)`, transition: "transform .6s ease" }}
              />
              <circle r={34} fill="none" stroke="var(--bg)" strokeWidth={2} />
            </g>
            <text x={80} y={PLANET_Y[box] + 50} textAnchor="middle" fill="var(--bg)" fontSize={11} fontWeight={700} letterSpacing="0.05em">
              {BOX_META[box].title.toUpperCase()}
            </text>
            <text x={80} y={PLANET_Y[box] + 65} textAnchor="middle" fill="var(--orange-500)" fontSize={11} fontWeight={800}>
              {progress.byBox[box]}%
            </text>
          </g>
        ))}

        <g style={{ transform: `translate(80px, ${astronautY(progress.overall)}px)`, transition: "transform .8s ease" }}>
          <g style={{ animation: "hdr-hop 2.2s ease-in-out infinite" }}>
            <AstronautFigure />
          </g>
        </g>
      </svg>
      <div className="mt-1.5 border-t-2 border-navy-500 pt-2.5">
        <p className="text-[11px] font-bold tracking-[0.08em] text-cream uppercase">Overall · {progress.overall}%</p>
      </div>
    </aside>
  );
}
