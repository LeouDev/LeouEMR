"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EwsRiskBadge } from "@/components/ui";
import { autoFlags, isAutoIndicator } from "@/lib/ews/auto-indicators";
import {
  computeEwsRisk,
  EWS_ACTION_PLANS,
  EWS_ATTRITION_CODES,
  EWS_ATTRITION_LABELS,
  expectsReturn,
  type EwsActionPlan,
  type EwsAttrition,
} from "@/lib/ews/engine";
import type { EwsRosterRow } from "@/lib/ews/roster";
import { describeActionError } from "@/lib/ui/action-error";
import { saveEwsAssessment } from "../employees/[employeeId]/ews-actions";
import { FIELD, LABEL } from "./ews-tabs";

/**
 * The tracker's edit form for one person: the ten warning indicators as
 * YES/NO pills (three of them locked, read from the week's figures), the
 * CAP, the action plan, the attrition or leave status with its dates, and
 * remarks. The badge at the top recomputes as anything changes, so the
 * band is seen before it is saved.
 *
 * Name, ID and position are shown, not edited: the roster is the imported
 * one, and a person's details change with the next workbook, not here.
 */

const PILL = "min-w-14 border-2 px-4 py-1.5 text-[11px] font-bold tracking-[0.04em]";

export function AssessmentDialog({
  row,
  indicators,
  week: dataWeek,
  onClose,
}: {
  row: EwsRosterRow;
  indicators: Array<{ code: string; label: string }>;
  /** The week the save is keyed on: the data week the figures came from. */
  week: string;
  onClose: () => void;
}) {
  // Status follows a person's newest record, so a save keyed earlier than
  // one already there would change nothing they can see: the newest week
  // wins.
  const week = row.latest && row.latest.week > dataWeek ? row.latest.week : dataWeek;
  const router = useRouter();
  const [manual, setManual] = useState<Record<string, boolean>>(row.manual);
  const [capActive, setCapActive] = useState(row.capActive);
  const [attrition, setAttrition] = useState<EwsAttrition>(row.attrition);
  const [attritionDate, setAttritionDate] = useState(row.latest?.attritionDate ?? "");
  const [expectedReturn, setExpectedReturn] = useState(row.latest?.expectedReturn ?? "");
  const [actionPlan, setActionPlan] = useState<EwsActionPlan | "">((row.latest?.actionPlan as EwsActionPlan | null) ?? "");
  const [notes, setNotes] = useState(row.latest?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const preview = useMemo(
    () => computeEwsRisk({ indicators: { ...manual, ...autoFlags(row.auto) }, capActive, attrition }),
    [manual, capActive, attrition, row.auto],
  );
  const leave = expectsReturn(attrition);

  async function save() {
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await saveEwsAssessment({
        employeeId: row.employeeId,
        week,
        indicators: manual,
        capActive,
        attrition,
        attritionDate: attrition === "none" ? "" : attritionDate,
        expectedReturn: leave ? expectedReturn : "",
        actionPlan: actionPlan || null,
        notes,
      });
    } catch (cause) {
      setError(describeActionError(cause));
      setSaving(false);
      return;
    }
    setSaving(false);
    if (result.ok) {
      router.refresh();
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ews-edit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/60 p-5"
      onClick={() => !saving && onClose()}
    >
      <div className="max-h-[88vh] w-full max-w-[640px] overflow-y-auto border-2 border-ink bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-ink bg-navy-800 px-5 py-4">
          <h2 id="ews-edit-title" className="text-base font-bold text-cream">
            Edit Employee
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-xl leading-none text-cream">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3.5 p-5">
          <div>
            <span className={LABEL}>Name</span>
            <p className="text-sm font-semibold text-ink">{row.name}</p>
          </div>
          <div>
            <span className={LABEL}>Employee ID</span>
            <p className="font-mono text-sm text-ink">{row.eid}</p>
          </div>
          <div className="col-span-2">
            <span className={LABEL}>Position</span>
            <p className="text-sm text-ink">{row.position ?? <span className="text-muted">—</span>}</p>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pb-1">
          <h3 className="text-xs font-bold tracking-[0.08em] text-muted uppercase">Warning indicators</h3>
          <EwsRiskBadge riskLevel={preview.riskLevel} score={preview.score} />
        </div>
        <div className="flex flex-col gap-1.5 px-5 pt-2.5 pb-1">
          {indicators.map((indicator) => {
            if (isAutoIndicator(indicator.code)) {
              const auto = row.auto[indicator.code];
              return (
                <div key={indicator.code} className="flex items-center justify-between gap-3 border-2 border-line px-3 py-2">
                  <div>
                    <span className="text-[13px] text-ink">{indicator.label}</span>
                    <div className="mt-0.5 text-[11px] text-ink-faint">Auto · {auto.caption}</div>
                  </div>
                  <span className={`${PILL} border-line bg-cream text-center ${auto.on ? "text-fail" : "text-muted"}`} title="Read from this week's figures">
                    {auto.on ? "YES" : "NO"}
                  </span>
                </div>
              );
            }
            const on = manual[indicator.code] ?? false;
            return (
              <div key={indicator.code} className="flex items-center justify-between gap-3 border-2 border-line px-3 py-2">
                <span className="text-[13px] text-ink">{indicator.label}</span>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setManual({ ...manual, [indicator.code]: !on })}
                  className={`${PILL} cursor-pointer ${on ? "border-orange-brand bg-orange-brand text-white" : "border-ink bg-surface text-ink"}`}
                >
                  {on ? "YES" : "NO"}
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 border-2 border-line bg-cream px-3 py-2">
            <span className="text-[13px] font-semibold text-ink">With active CAP?</span>
            <button
              type="button"
              aria-pressed={capActive}
              onClick={() => setCapActive(!capActive)}
              className={`${PILL} cursor-pointer ${capActive ? "border-orange-brand bg-orange-brand text-white" : "border-ink bg-surface text-ink"}`}
            >
              {capActive ? "YES" : "NO"}
            </button>
          </div>
        </div>

        <div className="space-y-3.5 px-5 pt-4 pb-5">
          <label className="block">
            <span className={LABEL}>Action plan</span>
            <select value={actionPlan} onChange={(e) => setActionPlan(e.target.value as EwsActionPlan | "")} className={FIELD}>
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
            <select value={attrition} onChange={(e) => setAttrition(e.target.value as EwsAttrition)} className={FIELD}>
              {EWS_ATTRITION_CODES.map((option) => (
                <option key={option} value={option}>
                  {EWS_ATTRITION_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          {(attrition === "black" || attrition === "absconding") && (
            <label className="block">
              <span className={LABEL}>{attrition === "black" ? "Effective date" : "Last day seen"}</span>
              <input type="date" value={attritionDate} onChange={(e) => setAttritionDate(e.target.value)} className={FIELD} />
            </label>
          )}
          {leave && (
            <div className="grid grid-cols-2 gap-3.5">
              <label className="block">
                <span className={LABEL}>Start date</span>
                <input type="date" value={attritionDate} onChange={(e) => setAttritionDate(e.target.value)} className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Expected return date</span>
                <input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} className={FIELD} />
              </label>
            </div>
          )}
          <label className="block">
            <span className={LABEL}>Remarks / comments</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for this record" className={`${FIELD} resize-y`} />
          </label>
          {error && (
            <p role="alert" className="bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t-2 border-line px-5 py-3.5">
          <button type="button" onClick={onClose} disabled={saving} className="border-2 border-ink bg-surface px-4 py-2 text-[13px] font-bold text-ink disabled:opacity-60">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="bg-orange-brand px-5 py-2 text-[13px] font-bold text-white transition hover:bg-orange-brand-dark disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
