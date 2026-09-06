"use client";

import { useMemo, useState } from "react";
import { computeSkillRating, computeSkillRatio } from "@/lib/kpi-engine/par-mbo";
import { updateSkillTarget } from "./actions";

export interface SkillRow {
  id: string;
  code: string;
  name: string;
  target: number;
  lowerIsBetter: boolean;
  r5: number;
  r4: number;
  r3: number;
  r2: number;
  r1: number;
}

/** Thresholds are stored as decimal ratios but always shown as percentages. */
function asPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function TargetCell({
  skill,
  editable,
  onSaved,
}: {
  skill: SkillRow;
  editable: boolean;
  onSaved: (target: number) => void;
}) {
  const [value, setValue] = useState(String(skill.target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return <span className="font-mono text-sm text-ink tabular-nums">{skill.target}</span>;
  }

  async function commit() {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Must be a positive number");
      setValue(String(skill.target));
      return;
    }
    if (parsed === skill.target) {
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    const result = await updateSkillTarget({ skillId: skill.id, target: parsed });
    setSaving(false);

    if (result.ok) {
      onSaved(result.target);
    } else {
      setError(result.error);
      setValue(String(skill.target));
    }
  }

  return (
    <span className="inline-flex flex-col">
      <input
        type="number"
        step="any"
        min="0"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(String(skill.target));
            setError(null);
            e.currentTarget.blur();
          }
        }}
        aria-label={`Target for ${skill.name}`}
        className="w-24 border-2 border-ink bg-surface px-2 py-1 text-right font-mono text-sm text-ink tabular-nums outline-none transition disabled:opacity-50"
      />
      {error && <span className="mt-0.5 text-[11px] text-fail">{error}</span>}
    </span>
  );
}

interface CalculatorRow {
  skillId: string;
  actual: string;
  prodHours: string;
}

function blankRow(skillId: string): CalculatorRow {
  return { skillId, actual: "", prodHours: "" };
}

export function SkillWorkspace({
  skills: initialSkills,
  canEditTargets,
  showReferenceTable = true,
}: {
  skills: SkillRow[];
  canEditTargets: boolean;
  /** A team lead has no configuration to reference here — just the calculator below it. */
  showReferenceTable?: boolean;
}) {
  const [skills, setSkills] = useState(initialSkills);
  const [rows, setRows] = useState<CalculatorRow[]>(() =>
    Array.from({ length: 3 }, (_, i) => blankRow(initialSkills[i]?.id ?? initialSkills[0]?.id ?? "")),
  );

  function updateRow(index: number, patch: Partial<CalculatorRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // One rating per row, plus the hours-weighted blend across whichever rows
  // have both an actual value and prod hours entered — the same weighting
  // real PAR scoring uses to blend an employee's skills into one rate.
  const calcRows = useMemo(
    () =>
      rows.map((row) => {
        const skill = skills.find((s) => s.id === row.skillId) ?? skills[0];
        if (!skill) return { skill: undefined, calc: null, hours: 0 };

        const actualValue = Number(row.actual);
        const hours = Number(row.prodHours);
        if (row.actual.trim() === "" || !Number.isFinite(actualValue)) {
          return { skill, calc: null, hours: 0 };
        }

        const ratio = computeSkillRatio(actualValue, skill.target, skill.lowerIsBetter);
        const rating = computeSkillRating(ratio, skill);
        return { skill, calc: { ratio, rating }, hours: Number.isFinite(hours) ? hours : 0 };
      }),
    [rows, skills],
  );

  const overall = useMemo(() => {
    const weighted = calcRows.filter((r) => r.calc && r.hours > 0);
    const totalHours = weighted.reduce((sum, r) => sum + r.hours, 0);
    if (weighted.length === 0 || totalHours <= 0) return null;
    const rating = weighted.reduce((sum, r) => sum + r.calc!.rating * (r.hours / totalHours), 0);
    return { rating, skillCount: weighted.length };
  }, [calcRows]);

  function handleTargetSaved(skillId: string, target: number) {
    setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, target } : s)));
  }

  return (
    <div className="space-y-6">
      {showReferenceTable && (
        <section className="overflow-hidden border-2 border-ink bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Skill reference</h2>
              <p className="mt-0.5 text-sm text-muted">
                {canEditTargets
                  ? "Targets are editable. Rating thresholds are locked scoring policy."
                  : "Read-only. Only administrators can change targets."}
              </p>
            </div>
            <p className="text-xs text-muted">
              Thresholds stored as ratios, shown as percentages of target
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink bg-cream">
                  <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Skill</th>
                  <th className="px-3 py-2.5 font-semibold text-ink">Target</th>
                  <th className="px-3 py-2.5 font-semibold text-ink">
                    Lower is better
                  </th>
                  {(["r5", "r4", "r3", "r2", "r1"] as const).map((key) => (
                    <th
                      key={key}
                      className="px-3 py-2.5 font-semibold text-ink"
                      title="Locked"
                    >
                      Rating {key.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.id} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                    <td className="px-6 py-2 font-medium text-ink">{skill.name}</td>
                    <td className="px-3 py-2">
                      <TargetCell
                        skill={skill}
                        editable={canEditTargets}
                        onSaved={(target) => handleTargetSaved(skill.id, target)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {skill.lowerIsBetter ? (
                        <span className="bg-orange-brand-100 px-2 py-0.5 text-xs font-semibold text-orange-brand-dark">
                          Yes
                        </span>
                      ) : (
                        <span className="text-xs text-muted">No</span>
                      )}
                    </td>
                    {(["r5", "r4", "r3", "r2", "r1"] as const).map((key) => (
                      <td
                        key={key}
                        className="px-3 py-2 font-mono text-xs text-muted tabular-nums"
                      >
                        {asPercent(skill[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="overflow-hidden border-2 border-ink bg-surface">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">Rating calculator</h2>
          <p className="mt-0.5 text-sm text-muted">
            Up to 3 skills, blended by prod hours into one productivity rating — the same
            hours-weighted average PAR scoring uses. Updates live as you type.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                    Skill
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                    Actual
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                    Prod hours
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Target</th>
                  <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Ratio</th>
                  <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const { skill, calc } = calcRows[i];
                  return (
                    <tr key={i} className="border-b-2 border-line last:border-0">
                      <td className="px-3 py-2.5">
                        <select
                          value={row.skillId}
                          onChange={(e) => updateRow(i, { skillId: e.target.value })}
                          className="w-full border-2 border-ink bg-surface px-2 py-1.5 text-sm text-ink outline-none transition"
                        >
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        {skill && (
                          <span className="mt-1 block text-[11px] text-muted">
                            {skill.lowerIsBetter ? "Lower is better" : "Higher is better"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={row.actual}
                          onChange={(e) => updateRow(i, { actual: e.target.value })}
                          placeholder="Actual"
                          className="w-28 border-2 border-ink bg-surface px-2 py-1.5 font-mono text-sm text-ink tabular-nums outline-none transition"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          value={row.prodHours}
                          onChange={(e) => updateRow(i, { prodHours: e.target.value })}
                          placeholder="Hours"
                          className="w-24 border-2 border-ink bg-surface px-2 py-1.5 font-mono text-sm text-ink tabular-nums outline-none transition"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">
                        {skill ? skill.target : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-ink tabular-nums">
                        {calc ? asPercent(calc.ratio) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-ink tabular-nums">
                        {calc ? calc.rating.toFixed(3) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted">
            Ratio is actual ÷ target for higher-is-better skills, target ÷ actual for
            lower-is-better ones (handle-time-style skills measured in seconds). Rows without
            both an actual value and prod hours are left out of the blend below.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="text-sm text-muted">
              {overall
                ? `Blended across ${overall.skillCount} skill${overall.skillCount === 1 ? "" : "s"}, weighted by prod hours.`
                : "Enter an actual value and prod hours for at least one skill to see a blended rating."}
            </p>
            <Readout
              label="Productivity rating"
              value={overall ? overall.rating.toFixed(3) : "—"}
              accent
              scale={overall ? overall.rating : undefined}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Readout({
  label,
  value,
  accent = false,
  scale,
}: {
  label: string;
  value: string;
  accent?: boolean;
  scale?: number;
}) {
  return (
    <div
      className={`border p-4 ${accent ? "border-orange-brand/40 bg-orange-brand-100/40" : "border-line bg-cream/60"
      }`}
    >
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p
        className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${accent ? "text-orange-brand-dark" : "text-ink"
        }`}
      >
        {value}
      </p>
      {scale !== undefined && (
        <div className="mt-2 h-1.5 bg-line">
          <div
            className="h-full bg-orange-brand transition-all"
            style={{ width: `${((scale - 1) / 4) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
