"use client";

import { useState } from "react";
import { computeEmployeeFinalRate, type RatingThresholds } from "@/lib/kpi-engine/par-mbo";

export interface CalculatorSkill {
  code: string;
  name: string;
  target: number;
  metric: "cph" | "aht" | "case_rate";
  lowerIsBetter: boolean;
  thresholds: RatingThresholds;
}

interface Row {
  id: number;
  skillCode: string;
  actual: string;
  prodHrs: string;
}

const input =
  "w-full border-2 border-ink bg-surface px-3 py-2 font-mono text-sm text-ink tabular-nums outline-none";
const head = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";
const num = "px-3 py-2.5 font-mono text-sm tabular-nums";

/**
 * What "Actual" means for this skill. Targets are bare numbers in very
 * different units — 11 cases per hour and 500 seconds sit in the same
 * column — so the unit is spelled out rather than left to be inferred.
 */
const UNIT: Record<CalculatorSkill["metric"], string> = {
  cph: "cases/hr",
  aht: "seconds",
  case_rate: "weight/case",
};

let nextId = 0;

/**
 * Builds one employee's final production rate, row by row.
 *
 * Every figure to the right of the inputs is derived by the same engine that
 * scores imported data — ratio, rating, hour-weight and the weighted sum are
 * `computeEmployeeFinalRate`, not a second implementation. A number worked
 * out here is the number the next import will produce.
 */
export function ProductivityCalculator({ skills }: { skills: CalculatorSkill[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    skills.slice(0, 3).map((s) => ({ id: nextId++, skillCode: s.code, actual: "", prodHrs: "" })),
  );

  if (skills.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted">No skills are configured yet.</p>;
  }

  const byCode = new Map(skills.map((s) => [s.code, s]));
  const num0 = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const update = (id: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Rows with no hours contribute no weight, so they are left out of the
  // computation entirely rather than counted as a zero-rated skill.
  const scored = rows.filter((r) => byCode.has(r.skillCode) && num0(r.prodHrs) > 0);
  const result = computeEmployeeFinalRate(
    scored.map((r) => {
      const skill = byCode.get(r.skillCode)!;
      return {
        skillCode: `${r.id}`,
        actual: num0(r.actual),
        target: skill.target,
        hoursWorked: num0(r.prodHrs),
        lowerIsBetter: skill.lowerIsBetter,
        thresholds: skill.thresholds,
      };
    }),
  );
  const computed = new Map(result.skills.map((s) => [s.skillCode, s]));

  const weightedParts = result.skills.map((s) => (s.rating * s.weight).toFixed(3));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-navy-800">
              <th className={`${head} px-6 text-cream`}>Skill</th>
              <th className={`${head} text-cream`}>Actual</th>
              <th className={`${head} text-cream`}>Target</th>
              <th className={`${head} text-cream`}>ProdHrs</th>
              <th className={`${head} text-cream`}>Ratio</th>
              <th className={`${head} text-cream`}>Rating</th>
              <th className={`${head} text-cream`}>Weight</th>
              <th className={`${head} px-6 text-cream`}>Weighted</th>
              <th className="w-10 bg-navy-800" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const skill = byCode.get(row.skillCode);
              const c = computed.get(`${row.id}`);
              return (
                <tr key={row.id} className="border-b-2 border-line last:border-0">
                  <td className="px-6 py-2">
                    <select
                      value={row.skillCode}
                      onChange={(e) => update(row.id, { skillCode: e.target.value })}
                      aria-label="Skill"
                      className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none"
                    >
                      {skills.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      aria-label="Actual"
                      value={row.actual}
                      onChange={(e) => update(row.id, { actual: e.target.value })}
                      className={input}
                    />
                  </td>
                  <td className={`${num} font-semibold text-ink`}>
                    {skill ? skill.target : "—"}
                    {skill && (
                      <span className="block text-[10px] font-normal text-muted">
                        {UNIT[skill.metric]}
                        {skill.lowerIsBetter ? " · lower is better" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      aria-label="Productive hours"
                      value={row.prodHrs}
                      onChange={(e) => update(row.id, { prodHrs: e.target.value })}
                      className={input}
                    />
                  </td>
                  <td className={`${num} text-muted`}>
                    {c ? `${(c.ratio * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td className={`${num} font-semibold text-ink`}>
                    {c ? c.rating.toFixed(3) : "—"}
                  </td>
                  <td className={`${num} text-muted`}>
                    {c ? `${(c.weight * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className={`${num} px-6 font-semibold text-ink`}>
                    {c ? (c.rating * c.weight).toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove ${skill?.name ?? "row"}`}
                        onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                        className="px-2 py-1 text-lg leading-none font-bold text-muted transition hover:text-fail"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            <tr className="border-t-2 border-ink bg-cream">
              <td className={`${head} px-6`}>Total ProdHrs</td>
              <td />
              <td />
              <td className={`${num} font-semibold text-ink`}>{result.totalHours.toFixed(2)}</td>
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink px-6 py-4">
        <button
          type="button"
          onClick={() =>
            setRows((prev) => [
              ...prev,
              { id: nextId++, skillCode: skills[0].code, actual: "", prodHrs: "" },
            ])
          }
          className="btn-secondary px-4 py-2 text-sm"
        >
          Add skill
        </button>
        <p className="text-xs text-muted">
          Rows with no productive hours carry no weight and are left out of the rate.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-orange-brand bg-cream px-6 py-5">
        <p className="font-mono text-sm text-muted">
          FINAL PRODUCTION RATE
          {weightedParts.length > 0 && ` = ${weightedParts.join(" + ")}`}
        </p>
        <p
          className={`font-mono text-[40px] leading-none font-extrabold tabular-nums ${
            result.totalHours === 0 ? "text-muted" : result.finalRate >= 3 ? "text-pass" : "text-fail"
          }`}
        >
          {result.totalHours === 0 ? "—" : result.finalRate.toFixed(3)}
        </p>
      </div>
    </div>
  );
}
