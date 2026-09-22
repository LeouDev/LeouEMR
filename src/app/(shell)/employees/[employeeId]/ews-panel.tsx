"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EwsRiskBadge } from "@/components/ui";
import { autoFlags, isAutoIndicator, type AutoIndicator, type AutoIndicatorCode } from "@/lib/ews/auto-indicators";
import {
  computeEwsRisk,
  EWS_ACTION_PLANS,
  EWS_ATTRITION_CODES,
  EWS_ATTRITION_LABELS,
  EWS_RISK_GUIDANCE,
  expectsReturn,
  type EwsActionPlan,
  type EwsAttrition,
} from "@/lib/ews/engine";
import { manualFlags } from "@/lib/ews/roster";
import { saveEwsAssessment } from "./ews-actions";
import { describeActionError } from "@/lib/ui/action-error";

export interface EwsIndicator {
  code: string;
  label: string;
}

export interface EwsAssessmentValues {
  indicators: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
  attritionDate: string;
  expectedReturn: string;
  actionPlan: EwsActionPlan | null;
  notes: string;
}

const FIELD = "w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60";
const LABEL = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * One week's assessment on the employee page. The same record the EWS
 * tracker edits, with the same three indicators read from the week's
 * figures rather than ticked: those rows are shown locked, with the figure
 * that decided them.
 */
export function EwsPanel({
  employeeId,
  week,
  indicators,
  initial,
  readOnly,
  assessedByName,
  auto,
}: {
  employeeId: string;
  week: string;
  indicators: EwsIndicator[];
  initial: EwsAssessmentValues;
  readOnly: boolean;
  assessedByName: string | null;
  /** The derived indicators for this week; null when there is no data to derive from. */
  auto: Record<AutoIndicatorCode, AutoIndicator> | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState({ ...initial, indicators: manualFlags(initial.indicators) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const derived = useMemo(() => (auto ? autoFlags(auto) : {}), [auto]);

  // Previewed live so the supervisor sees the band move as they tick boxes.
  const preview = useMemo(
    () =>
      computeEwsRisk({
        indicators: { ...values.indicators, ...derived },
        capActive: values.capActive,
        attrition: values.attrition,
      }),
    [values, derived],
  );
  const leave = expectsReturn(values.attrition);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    let result;
    try {
      result = await saveEwsAssessment({
        employeeId,
        week,
        indicators: values.indicators,
        capActive: values.capActive,
        attrition: values.attrition,
        attritionDate: values.attrition === "none" ? "" : values.attritionDate,
        expectedReturn: leave ? values.expectedReturn : "",
        actionPlan: values.actionPlan,
        notes: values.notes,
      });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSaving(false);
    }

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
        {indicators.map((indicator) => {
          if (isAutoIndicator(indicator.code)) {
            const derivedRow = auto?.[indicator.code] ?? null;
            const on = derivedRow?.on ?? false;
            return (
              <div
                key={indicator.code}
                className={`flex items-center gap-2.5 border px-3 py-2 text-sm ${on ? "border-fail/40 bg-fail-bg/40 text-ink" : "border-line bg-cream/60 text-ink"}`}
                title="Read from the week's figures, not ticked"
              >
                <input type="checkbox" disabled checked={on} readOnly className="h-4 w-4 border-2 border-ink" />
                <span>
                  {indicator.label}
                  <span className="block text-[11px] text-muted">Auto · {derivedRow?.caption ?? "No weekly data for this week"}</span>
                </span>
              </div>
            );
          }
          return (
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
          );
        })}
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
          <span className={LABEL}>Action plan</span>
          <select
            disabled={readOnly}
            value={values.actionPlan ?? ""}
            onChange={(e) => setValues({ ...values, actionPlan: (e.target.value || null) as EwsActionPlan | null })}
            className={FIELD}
          >
            <option value="">None</option>
            {EWS_ACTION_PLANS.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Attrition / leave status</span>
          <select
            disabled={readOnly}
            value={values.attrition}
            onChange={(e) => setValues({ ...values, attrition: e.target.value as EwsAttrition })}
            className={FIELD}
          >
            {EWS_ATTRITION_CODES.map((option) => (
              <option key={option} value={option}>
                {EWS_ATTRITION_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        {(values.attrition === "black" || values.attrition === "absconding") && (
          <label className="block">
            <span className={LABEL}>{values.attrition === "black" ? "Effective date" : "Last day seen"}</span>
            <input type="date" disabled={readOnly} value={values.attritionDate} onChange={(e) => setValues({ ...values, attritionDate: e.target.value })} className={FIELD} />
          </label>
        )}
        {leave && (
          <>
            <label className="block">
              <span className={LABEL}>Start date</span>
              <input type="date" disabled={readOnly} value={values.attritionDate} onChange={(e) => setValues({ ...values, attritionDate: e.target.value })} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Expected return date</span>
              <input type="date" disabled={readOnly} value={values.expectedReturn} onChange={(e) => setValues({ ...values, expectedReturn: e.target.value })} className={FIELD} />
            </label>
          </>
        )}
      </div>

      <label className="block">
        <span className={LABEL}>Observations</span>
        <textarea
          rows={2}
          disabled={readOnly}
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
          placeholder="What you observed this week"
          className={FIELD}
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
