"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useNavigation } from "@/components/navigation-progress";
import { Card } from "@/components/ui";
import type { AgentOption } from "@/lib/quality/agent-search";
import type { QaForm } from "@/lib/quality/forms";
import {
  OUTCOME_LABELS,
  outcomeOf,
  scoreAudit,
  stepsOf,
  type QaMark,
  type QaMarks,
  type QaOutcome,
  type QaStep,
} from "@/lib/quality/scoring";
import {
  TIME_MOTION_INCOMPLETE,
  emptyDraft,
  finalizeDraft,
  isComplete,
  timeMotionSpecOf,
  type TimeMotionDraft,
} from "@/lib/quality/time-motion";
import { describeActionError } from "@/lib/ui/action-error";
import { submitAudit } from "../actions";
import { Tag } from "../quality-tabs";
import { AgentSearch } from "./agent-search";
import { TimeMotionPanel } from "./time-motion-panel";

const control = "w-full border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition disabled:bg-cream disabled:text-muted";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

const OUTCOME_TONE: Record<QaOutcome, "pass" | "ink" | "warn" | "fail"> = {
  pass: "pass",
  monitor: "warn",
  fail: "fail",
  "auto-fail": "fail",
};

const SCORE_COLOR: Record<QaOutcome, string> = {
  pass: "text-pass",
  monitor: "text-ink",
  fail: "text-fail",
  "auto-fail": "text-fail",
};

type StepStatus = "pending" | "clear" | "fail";

const subscribeToNothing = () => () => {};

/** The evaluator's own calendar date, not the server's — theirs is what an audit is dated. */
function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * The audit stepper: pick the agent and form, fill the header, then walk
 * one category per step marking each attribute pass or fail. Everything
 * defaults to pass, so an evaluator only touches what went wrong. The
 * live score is the same function the server stores.
 */
export function AuditForm({
  agents,
  forms,
  evaluatorName,
  initialAgentId,
  today,
}: {
  agents: AgentOption[];
  forms: QaForm[];
  evaluatorName: string;
  initialAgentId: string;
  today: string;
}) {
  const { navigate } = useNavigation();
  const [agentId, setAgentId] = useState(initialAgentId);
  const [formKey, setFormKey] = useState("");
  // Rendered with the server's (UTC) today, then with the browser's own
  // once there — the way a client-only value is read without a mismatch.
  const localDate = useSyncExternalStore(subscribeToNothing, localToday, () => today);
  // Locked to the day it is filed; the transaction itself is dated by hand.
  const auditDate = localDate;
  const [transactionDate, setTransactionDate] = useState("");
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [marks, setMarks] = useState<QaMarks>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeMotion, setTimeMotion] = useState<TimeMotionDraft>(emptyDraft());
  const [tmOpen, setTmOpen] = useState(false);
  const [tmWarned, setTmWarned] = useState(false);

  const form = forms.find((f) => f.key === formKey) ?? null;
  const steps = useMemo(() => (form ? stepsOf(form.definition) : []), [form]);
  const score = useMemo(() => (form ? scoreAudit(form.definition, marks) : null), [form, marks]);
  const outcome = score ? outcomeOf(score.scorePct, score.isCritical) : null;
  const tmSpec = form ? timeMotionSpecOf(form.definition) : null;
  const tmComplete = !tmSpec || isComplete(tmSpec, timeMotion);
  // The warning shows after a blocked submit and clears itself once every segment has a value.
  const tmWarning = tmWarned && !tmComplete;

  const current: QaStep | undefined = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];
  const currentScore = score?.steps[steps.indexOf(current!)];

  function chooseForm(key: string) {
    setFormKey(key);
    setHeaderValues({});
    setMarks({});
    setRemarks({});
    setStepIndex(0);
    setVisited([0]);
    setError(null);
    setTimeMotion(emptyDraft());
    setTmOpen(false);
    setTmWarned(false);
  }

  function goTo(index: number) {
    const next = Math.max(0, Math.min(steps.length - 1, index));
    setStepIndex(next);
    setVisited((v) => (v.includes(next) ? v : [...v, next]));
  }

  function mark(key: string, value: QaMark) {
    setMarks((m) => ({ ...m, [key]: value }));
  }

  function markAll(step: QaStep, value: QaMark) {
    setMarks((m) => {
      const next = { ...m };
      for (const item of step.items) next[item.key] = value;
      return next;
    });
  }

  function statusOf(step: QaStep, index: number): StepStatus {
    if (step.items.some((item) => marks[item.key] === "fail")) return "fail";
    return visited.includes(index) ? "clear" : "pending";
  }

  async function submit() {
    if (!form || !agentId || transactionMissing || pendingSteps > 0) return;
    if (tmSpec && !tmComplete) {
      setTmWarned(true);
      setTmOpen(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    let result: Awaited<ReturnType<typeof submitAudit>>;
    try {
      result = await submitAudit({
        agentId,
        formKey: form.key,
        auditDate,
        transactionDate,
        headerValues,
        marks,
        remarks,
        timeMotion: tmSpec ? (finalizeDraft(tmSpec, timeMotion) ?? undefined) : undefined,
      });
    } catch (cause) {
      setError(describeActionError(cause, "The audit did not save — the request timed out or the connection dropped. Check History before filing it again."));
      setSubmitting(false);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    navigate("/quality/history");
  }

  const agentName = agents.find((a) => a.id === agentId)?.name;
  // Every category must have been looked at: a step never opened is still
  // "pending" in the list, and an audit with one cannot be filed.
  const pendingSteps = steps.filter((step, i) => statusOf(step, i) === "pending").length;
  const transactionMissing = transactionDate === "";
  const canSubmit = Boolean(agentId) && !transactionMissing && pendingSteps === 0 && !submitting;

  return (
    <div className="space-y-5">
      {/* Overflow stays visible here: the agent search's match list hangs below its box, past the card's edge. */}
      <Card className="overflow-visible!">
        <div className="p-6">
          <h2 className="text-lg font-bold text-ink">Set up audit</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AgentSearch agents={agents} value={agentId} onChange={setAgentId} classes={{ label, control }} />
            <label>
              <span className={label}>Form</span>
              <select value={formKey} onChange={(e) => chooseForm(e.target.value)} className={control}>
                <option value="">Select form…</option>
                {forms.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Evaluator</span>
              <input type="text" value={evaluatorName} disabled className={control} />
            </label>
          </div>

          {form && (
            <>
              <hr className="my-5 border-t-2 border-line" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  <span className={label}>Audit date</span>
                  <input type="date" value={auditDate} disabled className={`${control} font-mono`} />
                  <span className="mt-1 block text-[11px] text-muted">Today — the day the audit is filed.</span>
                </label>
                <label>
                  <span className={label}>Transaction date</span>
                  <input
                    type="date"
                    value={transactionDate}
                    max={localDate}
                    required
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className={`${control} font-mono`}
                  />
                  <span className="mt-1 block text-[11px] text-muted">When the call, case or fax happened.</span>
                </label>
                {form.headerFields.map((field) => (
                  <label key={field.key}>
                    <span className={label}>{field.label}</span>
                    {field.kind === "select" ? (
                      <select
                        value={headerValues[field.key] ?? ""}
                        onChange={(e) => setHeaderValues((h) => ({ ...h, [field.key]: e.target.value }))}
                        className={control}
                      >
                        <option value="">Select…</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={headerValues[field.key] ?? ""}
                        placeholder={field.placeholder}
                        maxLength={500}
                        onChange={(e) => setHeaderValues((h) => ({ ...h, [field.key]: e.target.value }))}
                        className={control}
                      />
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      {form && current && score && outcome && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-6 lg:w-64">
            <div className="border-2 border-ink bg-surface p-4 text-center">
              <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">Live score</p>
              <p className={`mt-2 text-4xl leading-none font-extrabold tabular-nums ${SCORE_COLOR[outcome]}`}>{Math.round(score.scorePct)}%</p>
              <p className="mt-1 font-mono text-xs text-muted">
                {score.earned} / {score.max} pts
              </p>
              <div className="mt-2">
                <Tag tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Tag>
              </div>
            </div>
            <nav aria-label="Categories" className="max-h-[60vh] overflow-y-auto border-2 border-ink bg-surface p-2">
              {steps.map((step, i) => {
                const status = statusOf(step, i);
                const active = i === stepIndex;
                return (
                  <button
                    key={step.name}
                    type="button"
                    onClick={() => goTo(i)}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs ${active ? "bg-orange-brand-100 font-bold text-ink" : "font-medium text-ink hover:bg-cream"}`}
                  >
                    <span className="truncate">{step.name}</span>
                    <span
                      className={`shrink-0 text-[10px] font-bold tracking-[0.04em] uppercase ${
                        status === "fail" ? "text-fail" : status === "clear" ? "text-pass" : "text-muted"
                      }`}
                    >
                      {status}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="border-2 border-ink bg-surface p-6">
              <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
                Step {stepIndex + 1} of {steps.length}
              </p>
              <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-ink">{current.name}</p>
                  <p className="text-xs text-muted">
                    {current.kind === "compliance"
                      ? "Any failure here zeroes the whole audit"
                      : `${currentScore?.earned ?? 0} / ${currentScore?.max ?? 0} pts`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => markAll(current, "pass")} className="btn-secondary px-3 py-1.5 text-xs">
                    Pass all
                  </button>
                  <button type="button" onClick={() => markAll(current, "fail")} className="btn-secondary px-3 py-1.5 text-xs">
                    Fail all
                  </button>
                </div>
              </div>

              <ul className="mt-4 divide-y-2 divide-line border-t-2 border-line">
                {current.items.map((item) => {
                  const value: QaMark = marks[item.key] === "fail" ? "fail" : "pass";
                  // A sub-attribute shares its parent's points: any one of a
                  // group failing costs them once. Set in and labelled with
                  // what it shares, so neither the indent nor a blank space
                  // reads as "this one is free".
                  const shared = item.sharesWith
                    ? (current.items.find((other) => other.key === item.sharesWith)?.points ?? null)
                    : null;
                  return (
                    <li
                      key={item.key}
                      className={`flex items-center justify-between gap-4 py-2.5${item.sharesWith ? " pl-6" : ""}`}
                    >
                      <span className="text-sm text-ink">
                        {item.label}
                        {item.points !== null && <span className="text-muted"> · {item.points} pts</span>}
                        {shared !== null && <span className="text-muted"> · shares {shared} pts</span>}
                        {current.kind === "compliance" && value === "fail" && (
                          <span className="text-fail"> · score → 0</span>
                        )}
                      </span>
                      <div className="flex shrink-0 border-2 border-ink" role="group" aria-label={item.label}>
                        <button
                          type="button"
                          aria-pressed={value === "pass"}
                          onClick={() => mark(item.key, "pass")}
                          className={`px-3 py-1 text-xs font-bold tracking-[0.08em] uppercase ${value === "pass" ? "bg-ink text-white" : "bg-surface text-ink hover:bg-cream"}`}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          aria-pressed={value === "fail"}
                          onClick={() => mark(item.key, "fail")}
                          className={`border-l-2 border-ink px-3 py-1 text-xs font-bold tracking-[0.08em] uppercase ${value === "fail" ? "bg-fail text-white" : "bg-surface text-ink hover:bg-cream"}`}
                        >
                          Fail
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <label className="mt-4 block">
                <span className={label}>Remarks for this category</span>
                <textarea
                  rows={2}
                  value={remarks[current.name] ?? ""}
                  maxLength={2000}
                  placeholder="Optional notes for this category…"
                  onChange={(e) => setRemarks((r) => ({ ...r, [current.name]: e.target.value }))}
                  className={control}
                />
              </label>

              <div className="mt-4 flex justify-between gap-3 border-t-2 border-line pt-4">
                <button type="button" onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0} className="btn-secondary px-4 py-2 text-sm disabled:opacity-40">
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={() => goTo(stepIndex + 1)}
                  disabled={stepIndex >= steps.length - 1}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              {tmWarning && <span className="text-xs font-semibold text-fail">{TIME_MOTION_INCOMPLETE}</span>}
              {!agentId && <span className="text-xs text-muted">Choose an agent to submit.</span>}
              {agentId && transactionMissing && <span className="text-xs text-muted">Enter the transaction date to submit.</span>}
              {agentId && !transactionMissing && pendingSteps > 0 && (
                <span className="text-xs font-semibold text-fail">
                  Review every category before submitting — {pendingSteps} still pending.
                </span>
              )}
              <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary px-6 py-3 text-sm disabled:opacity-50">
                {submitting ? "Saving…" : agentName ? `Submit audit for ${agentName}` : "Submit audit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {form && tmSpec && (
        <TimeMotionPanel spec={tmSpec} draft={timeMotion} open={tmOpen} onToggle={() => setTmOpen((v) => !v)} onChange={setTimeMotion} />
      )}
    </div>
  );
}
