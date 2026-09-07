"use client";

import { useState } from "react";
import type { LoggedCase } from "@/lib/case-tracker/tracker";

const LABEL = "block text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase";
const FIELD =
  "w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-orange-brand";

type YesNo = "Y" | "N";

/** The four Yes/No answers, in the order they are asked. */
const QUESTIONS = [
  { key: "activeApproval", label: "Active approval on file?" },
  { key: "cancellationNote", label: "Note for cancellation?" },
  { key: "urgent", label: "Urgent?" },
  { key: "quantityLimit", label: "Quantity limit checked?" },
] as const;

type QuestionKey = (typeof QUESTIONS)[number]["key"];

/** The three things confirmed before a case may be saved at all. */
const CONFIRMATIONS = [
  { key: "provider", label: "Provider checked" },
  { key: "member", label: "Member checked" },
  { key: "drug", label: "Drug checked" },
] as const;

type ConfirmationKey = (typeof CONFIRMATIONS)[number]["key"];

/**
 * A pair of buttons rather than a sliding switch.
 *
 * Neither answer is the default: an untouched question stays unanswered and
 * the case will not save, so a required field cannot pass by being ignored.
 */
function YesNoField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: YesNo | null;
  onChange: (value: YesNo) => void;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5 flex" role="group" aria-label={label}>
        {(["Y", "N"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`flex-1 border-2 px-3 py-1.5 text-xs font-bold tracking-[0.08em] uppercase transition ${
              value === option
                ? "border-ink bg-ink text-cream"
                : "border-line bg-surface text-muted hover:border-ink hover:text-ink"
            } ${option === "N" ? "border-l-0" : ""}`}
          >
            {option === "Y" ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface CaseDraftResult {
  saved: LoggedCase;
}

/**
 * Logging one case, with the checklist that has to be worked through first.
 *
 * Stays open after a save and clears itself, because cases are logged in
 * runs — closing after each one turns a fifteen-case hour into fifteen round
 * trips through the button that opens this.
 */
export function CaseForm({
  date,
  skills,
  existingNumbers,
  onSave,
  onClose,
}: {
  date: string;
  skills: Array<{ code: string; name: string }>;
  /** Case numbers already logged, to catch the same one being entered twice. */
  existingNumbers: Set<string>;
  onSave: (entry: Omit<LoggedCase, "id" | "loggedAt">) => void;
  onClose: () => void;
}) {
  const [caseNumber, setCaseNumber] = useState("");
  const [skillCode, setSkillCode] = useState(skills[0]?.code ?? "");
  const [decision, setDecision] = useState<LoggedCase["decision"]>("Pend");
  const [confirmed, setConfirmed] = useState<Partial<Record<ConfirmationKey, boolean>>>({});
  const [answers, setAnswers] = useState<Partial<Record<QuestionKey, YesNo>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [duplicateOk, setDuplicateOk] = useState(false);

  const trimmed = caseNumber.trim();
  const isDuplicate = trimmed.length > 0 && existingNumbers.has(trimmed.toLowerCase());

  const reset = () => {
    setCaseNumber("");
    setDecision("Pend");
    setConfirmed({});
    setAnswers({});
    setDuplicateOk(false);
  };

  const save = () => {
    const missing: string[] = [];
    if (!trimmed) missing.push("PA case number");
    if (!skillCode) missing.push("Skill");
    for (const item of CONFIRMATIONS) if (!confirmed[item.key]) missing.push(item.label);
    for (const item of QUESTIONS) if (!answers[item.key]) missing.push(item.label);

    if (missing.length > 0) {
      setSaved(null);
      setError(`Still needed: ${missing.join(", ")}.`);
      return;
    }
    if (isDuplicate && !duplicateOk) {
      setSaved(null);
      setError(`${trimmed} is already logged. Save it again to record a second case with that number.`);
      setDuplicateOk(true);
      return;
    }

    onSave({
      date,
      caseNumber: trimmed,
      skillCode,
      decision,
      activeApproval: answers.activeApproval!,
      cancellationNote: answers.cancellationNote!,
      urgent: answers.urgent!,
      quantityLimit: answers.quantityLimit!,
    });

    setError(null);
    setSaved(`${trimmed} logged. Ready for the next one.`);
    reset();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-navy-900/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Log a case"
    >
      <div className="w-full max-w-3xl border-2 border-ink bg-surface">
        <div className="flex items-center justify-between border-b-2 border-ink bg-navy-800 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-cream">Log a case</h2>
            <p className="mt-0.5 font-mono text-xs text-orange-brand">{date}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-navy-500 px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand hover:text-orange-brand"
          >
            Close
          </button>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className={LABEL} htmlFor="ct-case-number">
                PA case number
              </label>
              <input
                id="ct-case-number"
                value={caseNumber}
                onChange={(e) => {
                  setCaseNumber(e.target.value);
                  setDuplicateOk(false);
                }}
                placeholder="PA-102938"
                autoComplete="off"
                className={`${FIELD} mt-1.5 font-mono`}
              />
              {isDuplicate && (
                <p className="mt-1.5 text-xs text-warn">Already logged today.</p>
              )}
            </div>

            <div>
              <label className={LABEL} htmlFor="ct-skill">
                Worked on
              </label>
              <select
                id="ct-skill"
                value={skillCode}
                onChange={(e) => setSkillCode(e.target.value)}
                className={`${FIELD} mt-1.5`}
              >
                {skills.map((skill) => (
                  <option key={skill.code} value={skill.code}>
                    {skill.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted">
                Counted against this skill&rsquo;s hours and target.
              </p>
            </div>

            <div>
              <label className={LABEL} htmlFor="ct-decision">
                Decision
              </label>
              <select
                id="ct-decision"
                value={decision}
                onChange={(e) => setDecision(e.target.value as LoggedCase["decision"])}
                className={`${FIELD} mt-1.5`}
              >
                <option value="Pend">Pend</option>
                <option value="Deny">Deny</option>
                <option value="Approved">Approved</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <span className={LABEL}>Checked before deciding</span>
              <div className="mt-1.5 space-y-1.5">
                {CONFIRMATIONS.map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center gap-2.5 border-2 border-line px-3 py-2 text-sm text-ink transition hover:border-ink"
                  >
                    <input
                      type="checkbox"
                      checked={confirmed[item.key] ?? false}
                      onChange={(e) =>
                        setConfirmed((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-orange-brand"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {QUESTIONS.map((item) => (
                <YesNoField
                  key={item.key}
                  label={item.label}
                  value={answers[item.key] ?? null}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [item.key]: value }))}
                />
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="border-t-2 border-ink bg-fail-bg px-6 py-3 text-sm text-fail">{error}</p>
        )}
        {saved && !error && (
          <p className="border-t-2 border-ink bg-pass-bg px-6 py-3 text-sm text-pass">{saved}</p>
        )}

        <div className="flex justify-end gap-2 border-t-2 border-ink px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Done
          </button>
          <button
            type="button"
            onClick={save}
            className="border-2 border-ink bg-ink px-4 py-2 text-sm font-bold tracking-[0.08em] text-cream uppercase transition hover:bg-orange-brand hover:border-orange-brand"
          >
            {isDuplicate && duplicateOk ? "Save anyway" : "Save & log another"}
          </button>
        </div>
      </div>
    </div>
  );
}
