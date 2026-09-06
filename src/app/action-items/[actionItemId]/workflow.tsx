"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acknowledge, saveActionPlan, saveRca, sendToAgent } from "../actions";

const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100";
const label = "mb-1.5 block text-sm font-medium text-navy-800";

export interface RcaValues {
  problemStatement: string;
  rootCauseCategoryId: string;
  rootCauseDetails: string;
  contributingFactors: string;
  evidenceNotes: string;
}

export interface PlanValues {
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
      className={`rounded-lg px-3 py-2 text-sm ${
        tone === "error" ? "bg-fail-bg text-fail" : "bg-pass-bg text-pass"
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

    const result = await saveRca({ actionItemId, ...values });
    setSaving(false);

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
        className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save RCA"}
      </button>
    </form>
  );
}

export function ActionPlanForm({
  actionItemId,
  initial,
  readOnly,
}: {
  actionItemId: string;
  initial: PlanValues;
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
        <Readonly term="Corrective action" value={values.correctiveAction} />
        <Readonly term="Expected behavior" value={values.expectedBehavior} />
        <Readonly term="Target" value={`${values.targetMetric} → ${values.targetValue}`} />
        <Readonly term="Due date" value={values.dueDate} />
        <Readonly term="Follow-up date" value={values.followUpDate} />
        <Readonly
          term="Support"
          value={
            [values.coachingRequired && "Coaching", values.trainingRequired && "Training"]
              .filter(Boolean)
              .join(", ") || "None"
          }
        />
        <Readonly term="Supervisor notes" value={values.supervisorNotes} />
      </dl>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);

    const result = await saveActionPlan({
      actionItemId,
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
    setSaving(false);

    if (result.ok) {
      setSaved("Action plan saved");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-6 py-5">
      <label className="block">
        <span className={label}>Corrective action</span>
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

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={values.coachingRequired}
            onChange={(e) => setValues({ ...values, coachingRequired: e.target.checked })}
            className="h-4 w-4 rounded border-line accent-[var(--brand-navy)]"
          />
          Coaching required
        </label>
        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={values.trainingRequired}
            onChange={(e) => setValues({ ...values, trainingRequired: e.target.checked })}
            className="h-4 w-4 rounded border-line accent-[var(--brand-navy)]"
          />
          Training required
        </label>
      </div>

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
        className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save action plan"}
      </button>
    </form>
  );
}

export function SendToAgentButton({
  actionItemId,
  disabledReason,
}: {
  actionItemId: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    setError(null);
    const result = await sendToAgent(actionItemId);
    setSending(false);
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
        className="rounded-lg bg-orange-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? "Sending…" : "Send to agent"}
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
    const result = await acknowledge(actionItemId);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="rounded-lg bg-orange-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-brand-dark disabled:opacity-50"
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
      <dd className="mt-0.5 whitespace-pre-wrap text-navy-900">{value || "—"}</dd>
    </div>
  );
}
