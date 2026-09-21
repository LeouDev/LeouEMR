"use client";

import { useRouter } from "next/navigation";
import { groupCategories, type PlanCategory } from "@/lib/rca-action-plan/plan-categories";
import { useState } from "react";
import { acknowledge, saveActionPlan, saveRca, sendToAgent } from "../actions";
import { describeActionError } from "@/lib/ui/action-error";

const field =
  "w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

export interface RcaValues {
  problemStatement: string;
  rootCauseCategoryId: string;
  rootCauseDetails: string;
  contributingFactors: string;
  evidenceNotes: string;
}

export interface PlanValues {
  categoryId: string;
  correctiveAction: string;
  expectedBehavior: string;
  targetMetric: string;
  targetValue: string;
  dueDate: string;
  followUpDate: string;
  coachingRequired: boolean;
  trainingRequired: boolean;
  supervisorNotes: string;
}

function Feedback({ message, tone }: { message: string | null; tone: "error" | "ok" }) {
  if (!message) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`px-3 py-2 text-sm ${tone === "error" ? "bg-fail-bg text-fail" : "bg-pass-bg text-pass"
      }`}
    >
      {message}
    </p>
  );
}

export function RcaForm({
  actionItemId,
  categories,
  initial,
  readOnly,
}: {
  actionItemId: string;
  categories: Array<{ id: string; label: string }>;
  initial: RcaValues;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (readOnly) {
    return (
      <dl className="space-y-3 px-6 py-5 text-sm">
        <Readonly term="Problem statement" value={values.problemStatement} />
        <Readonly
          term="Root cause category"
          value={categories.find((c) => c.id === values.rootCauseCategoryId)?.label ?? "—"}
        />
        <Readonly term="Root cause details" value={values.rootCauseDetails} />
        <Readonly term="Contributing factors" value={values.contributingFactors} />
        <Readonly term="Evidence / notes" value={values.evidenceNotes} />
      </dl>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);

    let result;
    try {
      result = await saveRca({ actionItemId, ...values });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSaving(false);
    }

    if (result.ok) {
      setSaved("RCA saved");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-6 py-5">
      <label className="block">
        <span className={label}>Problem statement</span>
        <textarea
          required
          rows={2}
          value={values.problemStatement}
          onChange={(e) => setValues({ ...values, problemStatement: e.target.value })}
          className={field}
        />
      </label>

      <label className="block">
        <span className={label}>Root cause category</span>
        <select
          required
          value={values.rootCauseCategoryId}
          onChange={(e) => setValues({ ...values, rootCauseCategoryId: e.target.value })}
          className={field}
        >
          <option value="">Select a category…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={label}>Root cause details</span>
        <textarea
          required
          rows={3}
          value={values.rootCauseDetails}
          onChange={(e) => setValues({ ...values, rootCauseDetails: e.target.value })}
          className={field}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Contributing factors</span>
          <textarea
            rows={2}
            value={values.contributingFactors}
            onChange={(e) => setValues({ ...values, contributingFactors: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Evidence / notes</span>
          <textarea
            rows={2}
            value={values.evidenceNotes}
            onChange={(e) => setValues({ ...values, evidenceNotes: e.target.value })}
            className={field}
          />
        </label>
      </div>

      <Feedback message={error} tone="error" />
      <Feedback message={saved} tone="ok" />

      <button
        type="submit"
        disabled={saving}
        className="btn-primary px-5 py-3 text-sm"
      >
        {saving ? "Saving…" : "Save RCA"}
      </button>
    </form>
  );
}

/** The two flags a trainer or SME owns on a plan: whether coaching and training are required. */
function SupportFlags({
  values,
  onChange,
}: {
  values: Pick<PlanValues, "coachingRequired" | "trainingRequired">;
  onChange: (next: Pick<PlanValues, "coachingRequired" | "trainingRequired">) => void;
}) {
  return (
    <div className="flex flex-wrap gap-6">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={values.coachingRequired}
          onChange={(e) => onChange({ ...values, coachingRequired: e.target.checked })}
          className="h-4 w-4 border-2 border-ink"
        />
        Coaching required
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={values.trainingRequired}
          onChange={(e) => onChange({ ...values, trainingRequired: e.target.checked })}
          className="h-4 w-4 border-2 border-ink"
        />
        Training required
      </label>
    </div>
  );
}

export function ActionPlanForm({
  actionItemId,
  initial,
  categories,
  readOnly,
  flagsOnly = false,
}: {
  actionItemId: string;
  initial: PlanValues;
  /** Active categories, already ordered; grouped in the select by groupLabel. */
  categories: PlanCategory[];
  readOnly: boolean;
  /**
   * A support role on a plan someone else wrote: the plan reads as a
   * record, and only the coaching and training flags can be saved. The
   * server applies just those two whatever else is submitted.
   */
  flagsOnly?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);

    let result;
    try {
      result = await saveActionPlan({
        actionItemId,
        categoryId: values.categoryId,
        correctiveAction: values.correctiveAction,
        expectedBehavior: values.expectedBehavior,
        targetMetric: values.targetMetric,
        targetValue: Number(values.targetValue),
        dueDate: values.dueDate,
        followUpDate: values.followUpDate,
        coachingRequired: values.coachingRequired,
        trainingRequired: values.trainingRequired,
        supervisorNotes: values.supervisorNotes,
      });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSaving(false);
    }

    if (result.ok) {
      setSaved(flagsOnly ? "Training and coaching saved" : "Action plan saved");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  if (readOnly || flagsOnly) {
    return (
      <div>
        <dl className="space-y-3 px-6 py-5 text-sm">
          <Readonly
            term="Action plan category"
            value={categories.find((c) => c.id === values.categoryId)?.label ?? "—"}
          />
          <Readonly term="Plan details" value={values.correctiveAction} />
          <Readonly term="Expected behavior" value={values.expectedBehavior} />
          <Readonly term="Target" value={`${values.targetMetric} → ${values.targetValue}`} />
          <Readonly term="Due date" value={values.dueDate} />
          <Readonly term="Follow-up date" value={values.followUpDate} />
          {!flagsOnly && (
            <Readonly
              term="Support"
              value={
                [values.coachingRequired && "Coaching", values.trainingRequired && "Training"]
                  .filter(Boolean)
                  .join(", ") || "None"
              }
            />
          )}
          <Readonly term="Supervisor notes" value={values.supervisorNotes} />
        </dl>
        {flagsOnly && (
          <form onSubmit={submit} className="space-y-4 border-t-2 border-line px-6 py-5">
            <p className="text-xs text-muted">
              Whether training or coaching is required is yours to change; the rest of the plan
              stays as its author wrote it.
            </p>
            <SupportFlags values={values} onChange={(next) => setValues({ ...values, ...next })} />
            <Feedback message={error} tone="error" />
            <Feedback message={saved} tone="ok" />
            <button type="submit" disabled={saving} className="btn-secondary px-5 py-3 text-sm">
              {saving ? "Saving…" : "Save training and coaching"}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-6 py-5">
      <label className="block">
        <span className={label}>Action plan category</span>
        <select
          required
          value={values.categoryId}
          onChange={(e) => setValues({ ...values, categoryId: e.target.value })}
          className={field}
        >
          <option value="">Select a category…</option>
          {/* Grouped in the order the rows came back, so the list reads in
              thirds rather than as seventeen flat options. A row with no
              group still renders, ungrouped, rather than disappearing. */}
          {groupCategories(categories).map(([heading, options]) =>
            heading ? (
              <optgroup key={heading} label={heading}>
                {options.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              options.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))
            ),
          )}
        </select>
      </label>

      <label className="block">
        {/* The same field it has always been — the column is still
            corrective_action — renamed to read as the detail under the
            category rather than a second, competing answer. */}
        <span className={label}>Plan details</span>
        <textarea
          required
          rows={2}
          value={values.correctiveAction}
          onChange={(e) => setValues({ ...values, correctiveAction: e.target.value })}
          className={field}
        />
      </label>

      <label className="block">
        <span className={label}>Expected behavior</span>
        <textarea
          required
          rows={2}
          value={values.expectedBehavior}
          onChange={(e) => setValues({ ...values, expectedBehavior: e.target.value })}
          className={field}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Target metric</span>
          <input
            required
            type="text"
            value={values.targetMetric}
            onChange={(e) => setValues({ ...values, targetMetric: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Target value</span>
          <input
            required
            type="number"
            step="any"
            value={values.targetValue}
            onChange={(e) => setValues({ ...values, targetValue: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Due date</span>
          <input
            required
            type="date"
            value={values.dueDate}
            onChange={(e) => setValues({ ...values, dueDate: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Follow-up date</span>
          <input
            required
            type="date"
            value={values.followUpDate}
            onChange={(e) => setValues({ ...values, followUpDate: e.target.value })}
            className={field}
          />
        </label>
      </div>

      <SupportFlags values={values} onChange={(next) => setValues({ ...values, ...next })} />

      <label className="block">
        <span className={label}>Supervisor notes</span>
        <textarea
          rows={2}
          value={values.supervisorNotes}
          onChange={(e) => setValues({ ...values, supervisorNotes: e.target.value })}
          className={field}
        />
      </label>

      <Feedback message={error} tone="error" />
      <Feedback message={saved} tone="ok" />

      <button
        type="submit"
        disabled={saving}
        className="btn-primary px-5 py-3 text-sm"
      >
        {saving ? "Saving…" : "Save action plan"}
      </button>
    </form>
  );
}

export function SendToAgentButton({
  actionItemId,
  disabledReason,
  label = "Send to agent",
}: {
  actionItemId: string;
  disabledReason: string | null;
  /** "Send to agent again" on a reopened item, where the plan has been to the agent once already. */
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    setError(null);
    let result;
    try {
      result = await sendToAgent(actionItemId);
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSending(false);
    }
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={send}
        disabled={sending || disabledReason !== null}
        title={disabledReason ?? undefined}
        className="btn-primary px-5 py-3 text-sm"
      >
        {sending ? "Sending…" : label}
      </button>
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      <Feedback message={error} tone="error" />
    </div>
  );
}

export function AcknowledgeButton({ actionItemId }: { actionItemId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await acknowledge(actionItemId);
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="btn-primary px-5 py-3 text-sm"
      >
        {busy ? "Recording…" : "I acknowledge this plan"}
      </button>
      <Feedback message={error} tone="error" />
    </div>
  );
}

function Readonly({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{term}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-ink">{value || "—"}</dd>
    </div>
  );
}
