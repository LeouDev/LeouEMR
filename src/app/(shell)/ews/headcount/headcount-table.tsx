"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MONTH_NAMES, type HeadcountMonth } from "@/lib/ews/headcount";
import type { EwsTeam } from "@/lib/queries/ews";
import { describeActionError } from "@/lib/ui/action-error";
import { saveHeadcountMonth } from "../actions";
import { FIELD, HEAD, LABEL } from "../ews-tabs";

/** The twelve months, with the edit form behind each for the team that owns them. */
export function HeadcountTable({ chain, year, team }: { chain: HeadcountMonth[]; year: number; team: EwsTeam | null }) {
  const [editing, setEditing] = useState<HeadcountMonth | null>(null);
  const num = "px-2.5 py-2.5 text-right font-mono tabular-nums";

  return (
    <>
      <div className="overflow-x-auto border-2 border-ink bg-surface">
        <table className="w-full min-w-[920px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className={`${HEAD} px-4`}>Month</th>
              <th className={`${HEAD} text-right`}>Opening</th>
              <th className={`${HEAD} text-right`}>New hires</th>
              <th className={`${HEAD} text-right`}>Transfer in</th>
              <th className={`${HEAD} text-right`}>Transfer out</th>
              <th className={`${HEAD} text-right`}>Attrition</th>
              <th className={`${HEAD} text-right`}>Closing</th>
              {team && <th className={`${HEAD} px-4`} aria-label="Edit" />}
            </tr>
          </thead>
          <tbody>
            {chain.map((m) => (
              <tr key={m.month} className="border-b-2 border-line last:border-0">
                <td className="px-4 py-2.5 text-left font-bold text-ink">{m.label}</td>
                <td className={`${num} text-ink`}>{m.opening}</td>
                <td className={`${num} text-pass`}>{m.newHires ? `+${m.newHires}` : "0"}</td>
                <td className={`${num} text-ink`}>{m.transferIn}</td>
                <td className={`${num} text-ink`}>{m.transferOut}</td>
                <td className={`${num} text-fail`}>{m.attrition ? `-${m.attrition}` : "0"}</td>
                <td className={`${num} font-extrabold text-ink`}>{m.closing}</td>
                {team && (
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => setEditing(m)} className="cursor-pointer text-xs font-bold text-orange-brand hover:underline">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && team && <MonthDialog month={editing} year={year} team={team} onClose={() => setEditing(null)} />}
    </>
  );
}

function MonthDialog({ month, year, team, onClose }: { month: HeadcountMonth; year: number; team: EwsTeam; onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({
    openingOverride: month.openingOverride === null ? "" : String(month.openingOverride),
    newHires: String(month.newHires),
    transferIn: String(month.transferIn),
    transferOut: String(month.transferOut),
    voluntaryAttrition: String(month.voluntaryAttrition),
    involuntaryAttrition: String(month.involuntaryAttrition),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const field = (key: keyof typeof values, label: string, placeholder?: string, span = false) => (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <span className={LABEL}>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={values[key]}
        placeholder={placeholder}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        className={FIELD}
      />
    </label>
  );

  async function save() {
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await saveHeadcountMonth({
        supervisorEid: team.supervisorEid,
        year,
        month: month.month,
        openingOverride: values.openingOverride.trim() === "" ? "" : values.openingOverride,
        newHires: values.newHires || 0,
        transferIn: values.transferIn || 0,
        transferOut: values.transferOut || 0,
        voluntaryAttrition: values.voluntaryAttrition || 0,
        involuntaryAttrition: values.involuntaryAttrition || 0,
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
    <div role="dialog" aria-modal="true" aria-labelledby="hc-edit-title" className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/60 p-5" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-[440px] border-2 border-ink bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-ink bg-navy-800 px-5 py-4">
          <h2 id="hc-edit-title" className="text-base font-bold text-cream">
            Edit {MONTH_NAMES[month.month - 1]} {year}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-xl leading-none text-cream">
            ×
          </button>
        </div>
        <p className="border-b-2 border-line px-5 py-2.5 text-xs text-muted">{team.supervisorName}&rsquo;s team</p>
        <div className="grid grid-cols-2 gap-3.5 p-5">
          {field("openingOverride", "Opening HC override", "Blank = carry forward", true)}
          {field("newHires", "New hires")}
          {field("transferIn", "Transfer in")}
          {field("transferOut", "Transfer out")}
          {field("voluntaryAttrition", "Voluntary attrition")}
          {field("involuntaryAttrition", "Involuntary attrition")}
          {error && (
            <p role="alert" className="col-span-2 bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2.5 border-t-2 border-line px-5 py-3.5">
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
