"use client";

import { useMemo, useState } from "react";
import {
  computeQualityTotals,
  normalizeSkill,
  rowAttributes,
  DEFAULT_ATTRIBUTES_PER_AUDIT,
} from "@/lib/kpi-engine/quality-metrics";

export interface SkillAttributeOption {
  name: string;
  attributesPerAudit: number;
}

interface Row {
  id: number;
  skill: string;
  audits: string;
  markdowns: string;
  imperfect: string;
}

let nextId = 1;

function blankRow(skill: string): Row {
  return { id: nextId++, skill, audits: "", markdowns: "", imperfect: "" };
}

const numberInput =
  "w-20 border-2 border-ink bg-surface px-2 py-1 text-right font-mono text-sm text-ink tabular-nums outline-none transition";

export function QualityCalculator({ skills }: { skills: SkillAttributeOption[] }) {
  const [rows, setRows] = useState<Row[]>(() => [
    blankRow(skills[0]?.name ?? ""),
    blankRow(skills[1]?.name ?? skills[0]?.name ?? ""),
  ]);

  const attributesBySkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const skill of skills) map.set(normalizeSkill(skill.name), skill.attributesPerAudit);
    return map;
  }, [skills]);

  const records = useMemo(
    () =>
      rows.map((row) => ({
        skill: row.skill,
        audits: Number(row.audits) || 0,
        markdowns: Number(row.markdowns) || 0,
        imperfect: Number(row.imperfect) || 0,
      })),
    [rows],
  );

  const totals = useMemo(
    () => computeQualityTotals(records, attributesBySkill),
    [records, attributesBySkill],
  );

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <section className="overflow-hidden border-2 border-ink bg-surface">
      <div className="border-b border-line px-6 py-4">
        <h2 className="text-base font-semibold text-ink">DPU / DPO calculator</h2>
        <p className="mt-0.5 text-sm text-muted">
          One row per audited skill. DPU is a straight sum across every record; DPO weights each
          record by its own skill&apos;s attributes. Updates live — no submit needed.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Skill</th>
              <th className="px-3 py-2.5 font-semibold text-ink">Audits</th>
              <th className="px-3 py-2.5 font-semibold text-ink">Markdown</th>
              <th className="px-3 py-2.5 font-semibold text-ink">#&lt;100</th>
              <th className="px-3 py-2.5 font-semibold text-ink">Attributes</th>
              <th className="px-3 py-2.5 font-semibold text-ink">Row attributes</th>
              <th className="px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const perAudit =
                attributesBySkill.get(normalizeSkill(row.skill)) ?? DEFAULT_ATTRIBUTES_PER_AUDIT;
              const rowAttrs = rowAttributes(
                { skill: row.skill, audits: Number(row.audits) || 0 },
                attributesBySkill,
              );

              return (
                <tr key={row.id} className="border-b border-line/70 last:border-0">
                  <td className="px-6 py-2">
                    <select
                      value={row.skill}
                      onChange={(e) => update(row.id, { skill: e.target.value })}
                      className="w-48 border-2 border-ink bg-surface px-2 py-1 text-sm text-ink outline-none transition"
                    >
                      {skills.map((skill) => (
                        <option key={skill.name} value={skill.name}>
                          {skill.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      value={row.audits}
                      onChange={(e) => update(row.id, { audits: e.target.value })}
                      className={numberInput}
                      aria-label="Audits"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      value={row.markdowns}
                      onChange={(e) => update(row.id, { markdowns: e.target.value })}
                      className={numberInput}
                      aria-label="Markdown"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      value={row.imperfect}
                      onChange={(e) => update(row.id, { imperfect: e.target.value })}
                      className={numberInput}
                      aria-label="Under 100"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted tabular-nums">
                    {perAudit}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm text-ink tabular-nums">
                    {rowAttrs}
                  </td>
                  <td className="px-6 py-2">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      disabled={rows.length === 1}
                      className="text-sm text-muted transition hover:text-fail disabled:opacity-30"
                      aria-label="Remove row"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-cream/60 font-medium">
              <td className="px-6 py-2 text-ink">Totals</td>
              <td className="px-3 py-2 font-mono tabular-nums text-ink">
                {totals.audits}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums text-ink">
                {totals.markdowns}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums text-ink">
                {totals.imperfect}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 font-mono tabular-nums text-ink">
                {totals.attributes}
              </td>
              <td className="px-6 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-4">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, blankRow(skills[0]?.name ?? "")])}
          className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
        >
          Add skill row
        </button>

        <div className="flex gap-3">
          <Readout
            label="DPU"
            value={totals.dpu === null ? "—" : `${totals.dpu.toFixed(2)}%`}
            formula={`(${totals.audits} − ${totals.imperfect}) / ${totals.audits}`}
            passing={totals.dpu !== null && totals.dpu >= 95}
          />
          <Readout
            label="DPO"
            value={totals.dpo === null ? "—" : `${totals.dpo.toFixed(2)}%`}
            formula={`(${totals.attributes} − ${totals.markdowns}) / ${totals.attributes}`}
            passing={totals.dpo !== null && totals.dpo >= 95}
          />
        </div>
      </div>
    </section>
  );
}

function Readout({
  label,
  value,
  formula,
  passing,
}: {
  label: string;
  value: string;
  formula: string;
  passing: boolean;
}) {
  return (
    <div
      className={`min-w-40 border p-3 ${passing ? "border-pass/30 bg-pass-bg/40" : "border-line bg-cream/60"
      }`}
    >
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p
        className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${passing ? "text-pass" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-muted">{formula}</p>
    </div>
  );
}
