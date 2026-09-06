"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { computeEwsRisk, EWS_RISK_GUIDANCE, EWS_RISK_LABELS } from "@/lib/ews/engine";
import type { EwsAttrition } from "@/lib/ews/engine";
import { saveEwsAssessment } from "./ews-actions";

export interface EwsIndicator {
  code: string;
  label: string;
}

export interface EwsAssessmentValues {
  indicators: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
  attritionDate: string;
  notes: string;
}

const RISK_STYLES: Record<string, string> = {
  GREEN: "bg-pass-bg text-pass",
  YELLOW: "bg-warn-bg text-warn",
  RED: "bg-fail-bg text-fail",
  BLACK: "bg-navy-900 text-white",
};

const ATTRITION_OPTIONS: Array<{ value: EwsAttrition; label: string }> = [
  { value: "none", label: "None" },
  { value: "black", label: "Confirmed resignation / termination" },
  { value: "absconding", label: "Absconding" },
  { value: "loa", label: "Leave of absence" },
  { value: "maternity", label: "Maternity" },
];

export function EwsRiskBadge({ riskLevel, score }: { riskLevel: string; score?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold ${
        RISK_STYLES[riskLevel] ?? "bg-line text-muted"
      }`}
    >
      {EWS_RISK_LABELS[riskLevel as keyof typeof EWS_RISK_LABELS] ?? riskLevel}
      {score !== undefined && <span className="font-mono opacity-70">{score}</span>}
    </span>
  );
}

export function EwsPanel({
  employeeId,
  week,
  indicators,
  initial,
  readOnly,
  assessedByName,
}: {
  employeeId: string;
  week: string;
  indicators: EwsIndicator[];
  initial: EwsAssessmentValues;
  readOnly: boolean;
  assessedByName: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Previewed live so the supervisor sees the band move as they tick boxes.
  const preview = useMemo(
    () =>
      computeEwsRisk({
        indicators: values.indicators,
        capActive: values.capActive,
        attrition: values.attrition,
      }),
    [values],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await saveEwsAssessment({ employeeId, week, ...values });
    setSaving(false);

    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const body = (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        {indicators.map((indicator) => (
          <label
            key={indicator.code}
            className={`flex items-center gap-2.5 border px-3 py-2 text-sm transition ${values.indicators[indicator.code] ? "border-orange-brand/40 bg-orange-brand-100/30 text-ink"
                : "border-line text-ink"
            } ${readOnly ? "" : "cursor-pointer hover:border-orange-brand"}`}
          >
            <input
              type="checkbox"
              disabled={readOnly}
              checked={values.indicators[indicator.code] ?? false}
              onChange={(e) =>
                setValues({
                  ...values,
                  indicators: { ...values.indicators, [indicator.code]: e.target.checked },
                })
              }
              className="h-4 w-4 border-2 border-ink"
            />
            {indicator.label}
          </label>
        ))}
      </div>

      <label
        className={`flex items-center gap-2.5 border px-3 py-2 text-sm ${values.capActive ? "border-orange-brand/40 bg-orange-brand-100/30" : "border-line"
        } ${readOnly ? "" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          disabled={readOnly}
          checked={values.capActive}
          onChange={(e) => setValues({ ...values, capActive: e.target.checked })}
          className="h-4 w-4 border-2 border-ink"
        />
        Active corrective action plan
        <span className="ml-auto text-xs text-muted">counts one point</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Attrition status</span>
          <select
            disabled={readOnly}
            value={values.attrition}
            onChange={(e) => setValues({ ...values, attrition: e.target.value as EwsAttrition })}
            className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60"
          >
            {ATTRITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {values.attrition !== "none" && (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Effective date</span>
            <input
              type="date"
              disabled={readOnly}
              value={values.attritionDate}
              onChange={(e) => setValues({ ...values, attritionDate: e.target.value })}
              className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60"
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Observations</span>
        <textarea
          rows={2}
          disabled={readOnly}
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
          placeholder="What you observed this week"
          className="w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 bg-cream/70 px-4 py-3">
        <EwsRiskBadge riskLevel={preview.riskLevel} score={preview.score} />
        <p className="text-sm text-muted">
          {EWS_RISK_GUIDANCE[preview.riskLevel]}
          {assessedByName && readOnly && ` · Recorded by ${assessedByName}`}
        </p>
      </div>

      {error && (
        <p role="alert" className="bg-fail-bg px-3 py-2 text-sm text-fail">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="bg-pass-bg px-3 py-2 text-sm text-pass">
          Assessment saved
        </p>
      )}
    </>
  );

  if (readOnly) return <div className="space-y-4 px-6 py-5">{body}</div>;

  return (
    <form onSubmit={submit} className="space-y-4 px-6 py-5">
      {body}
      <button
        type="submit"
        disabled={saving}
        className="btn-primary px-5 py-3 text-sm"
      >
        {saving ? "Saving…" : "Save assessment"}
      </button>
    </form>
  );
}
