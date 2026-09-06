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

export function SkillWorkspace({
  skills: initialSkills,
  canEditTargets,
}: {
  skills: SkillRow[];
  canEditTargets: boolean;
}) {
  const [skills, setSkills] = useState(initialSkills);
  const [selectedId, setSelectedId] = useState(initialSkills[0]?.id ?? "");
  const [actual, setActual] = useState("");

  const selected = skills.find((s) => s.id === selectedId) ?? skills[0];

  const calc = useMemo(() => {
    if (!selected) return null;
    const actualValue = Number(actual);
    if (actual.trim() === "" || !Number.isFinite(actualValue)) return null;

    const ratio = computeSkillRatio(actualValue, selected.target, selected.lowerIsBetter);
    const rating = computeSkillRating(ratio, selected);
    return { ratio, rating };
  }, [actual, selected]);

  function handleTargetSaved(skillId: string, target: number) {
    setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, target } : s)));
  }

  return (
    <div className="space-y-6">
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

      <section className="overflow-hidden border-2 border-ink bg-surface">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">Rating calculator</h2>
          <p className="mt-0.5 text-sm text-muted">
            Updates live as you type — no submit needed.
          </p>
        </div>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Skill</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition"
              >
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Actual</span>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="Enter actual performance"
                className="w-full border-2 border-ink bg-surface px-3 py-2 font-mono text-sm text-ink tabular-nums outline-none transition"
              />
              {selected && (
                <span className="mt-1.5 block text-xs text-muted">
                  {selected.lowerIsBetter
                    ? "Lower is better — ratio is target ÷ actual"
                    : "Higher is better — ratio is actual ÷ target"}
                </span>
              )}
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Readout label="Target" value={selected ? String(selected.target) : "—"} />
            <Readout label="Ratio" value={calc ? asPercent(calc.ratio) : "—"} />
            <Readout
              label="Rating"
              value={calc ? calc.rating.toFixed(3) : "—"}
              accent
              scale={calc ? calc.rating : undefined}
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
