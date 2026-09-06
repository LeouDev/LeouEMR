"use client";

import { useState } from "react";
import { computeNps, promotersNeeded, totalResponses } from "@/lib/kpi-engine/nps";
import type { NpsBreakdown } from "@/lib/queries/my-stats";

const cell = "px-4 py-3 font-mono text-base text-ink tabular-nums";

/**
 * The month's NPS mix, and what it would take to reach target.
 *
 * The counts come from the stored month to date; the inputs let an agent add
 * hypothetical responses on top to see where the score would land. Both use
 * the same functions the scored data does.
 */
export function NpsCalculator({
  mtd,
  target,
  monthLabel,
}: {
  mtd: NpsBreakdown;
  target: number;
  monthLabel: string;
}) {
  const [extraPromoters, setExtraPromoters] = useState("");
  const [extraPassives, setExtraPassives] = useState("");
  const [extraDetractors, setExtraDetractors] = useState("");

  const n = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  const projected = {
    promoters: mtd.promoters + n(extraPromoters),
    passives: mtd.passives + n(extraPassives),
    detractors: mtd.detractors + n(extraDetractors),
  };

  const added = n(extraPromoters) + n(extraPassives) + n(extraDetractors);
  const current = computeNps(mtd);
  const projectedScore = computeNps(projected);
  const needed = promotersNeeded(mtd, target);

  const tone = (score: number | null) =>
    score === null ? "text-muted" : score >= target ? "text-pass" : "text-fail";

  const rows = [
    { label: "Promoters", value: mtd.promoters, extra: extraPromoters, set: setExtraPromoters },
    { label: "Passives", value: mtd.passives, extra: extraPassives, set: setExtraPassives },
    { label: "Detractors", value: mtd.detractors, extra: extraDetractors, set: setExtraDetractors },
  ];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Response
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                {monthLabel}
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Add
              </th>
              <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Projected
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b-2 border-line last:border-0">
                <td className="px-6 py-3 font-medium text-ink">{row.label}</td>
                <td className={cell}>{row.value}</td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    aria-label={`Additional ${row.label.toLowerCase()}`}
                    value={row.extra}
                    onChange={(e) => row.set(e.target.value)}
                    className="w-24 border-2 border-ink bg-surface px-2 py-1.5 text-right font-mono text-sm text-ink tabular-nums outline-none"
                  />
                </td>
                <td className={`${cell} px-6 font-semibold`}>
                  {row.value + n(row.extra)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink bg-cream">
              <td className="px-6 py-3 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Responses
              </td>
              <td className={cell}>{totalResponses(mtd)}</td>
              <td className={cell}>{added || "—"}</td>
              <td className={`${cell} px-6 font-semibold`}>{totalResponses(projected)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 border-t-2 border-ink p-6 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
            {monthLabel} NPS
          </p>
          <p className={`mt-2 font-mono text-[32px] leading-none font-extrabold tabular-nums ${tone(current)}`}>
            {current === null ? "—" : current.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-muted">Target {target}</p>
        </div>

        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
            Projected
          </p>
          <p
            className={`mt-2 font-mono text-[32px] leading-none font-extrabold tabular-nums ${tone(projectedScore)}`}
          >
            {projectedScore === null ? "—" : projectedScore.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {added > 0 ? `With ${added} more response${added === 1 ? "" : "s"}` : "Add responses above"}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
            Promoters to target
          </p>
          <p className="mt-2 font-mono text-[32px] leading-none font-extrabold text-ink tabular-nums">
            {needed === null ? "—" : needed}
          </p>
          <p className="mt-1 text-xs text-muted">
            {totalResponses(mtd) === 0
              ? // Zero responses also yields needed === 0, which would otherwise
                // congratulate an agent for a target they have not been measured
                // against at all.
                "No responses recorded yet this month"
              : needed === null
                ? "Target cannot be reached by adding promoters"
                : needed === 0
                  ? "Already at or above target"
                  : `Consecutive promoters to reach ${target}`}
          </p>
        </div>
      </div>

      {mtd.unclassified > 0 && (
        <p className="border-t-2 border-line px-6 py-3 text-xs text-muted">
          {mtd.unclassified} of {mtd.responses} responses this month were imported before the
          response mix was recorded, so they count towards the score but not the split above. A
          re-import of those weeks fills them in.
        </p>
      )}
    </div>
  );
}
