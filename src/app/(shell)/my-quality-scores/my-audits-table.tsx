"use client";

import { useEffect, useState } from "react";
import { failedFindings, groupedResults, scoreTone, type MyAudit } from "@/lib/quality/my-scores";
import { OUTCOME_LABELS, outcomeOf, type QaOutcome } from "@/lib/quality/scoring";
import { describeActionError } from "@/lib/ui/action-error";
import { Tag } from "../quality/quality-tabs";
import { acknowledgeAudit } from "./actions";

const OUTCOME_TONE: Record<QaOutcome, "pass" | "warn" | "fail"> = {
  pass: "pass",
  monitor: "warn",
  fail: "fail",
  "auto-fail": "fail",
};

const SCORE_CLASS = { pass: "text-pass", ink: "text-ink", fail: "text-fail" } as const;

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The agent's audits, newest first, and a drawer with one audit's findings,
 * the team lead's remarks, the full scored form on request, and the
 * acknowledgement — the one thing an agent writes here.
 */
export function MyAuditsTable({ audits }: { audits: MyAudit[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = [...audits].sort((a, b) => b.auditDate.localeCompare(a.auditDate));
  const open = rows.find((a) => a.id === openId) ?? null;
  const ackOf = (audit: MyAudit) => acknowledged[audit.id] ?? audit.acknowledgedAt;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function show(id: string) {
    setOpenId(id);
    setShowForm(false);
    setError(null);
  }

  async function acknowledge(audit: MyAudit) {
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof acknowledgeAudit>>;
    try {
      result = await acknowledgeAudit({ auditId: audit.id });
    } catch (cause) {
      setError(describeActionError(cause, "That did not go through — the connection dropped or the request timed out. Try again in a moment."));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAcknowledged((a) => ({ ...a, [audit.id]: result.acknowledgedAt }));
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Form</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Date</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Evaluator</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Score</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Result</th>
              <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((audit) => {
              const outcome = outcomeOf(audit.scorePct, audit.isCritical);
              const ack = ackOf(audit);
              return (
                <tr key={audit.id} onClick={() => show(audit.id)} className="cursor-pointer border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                  <td className="px-6 py-2 font-semibold text-ink">{audit.formLabel}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{formatDate(audit.auditDate)}</td>
                  <td className="px-3 py-2 text-xs text-muted">{audit.evaluatorName}</td>
                  <td className={`px-3 py-2 text-right font-mono text-sm font-bold tabular-nums ${SCORE_CLASS[scoreTone(audit.scorePct, audit.isCritical)]}`}>
                    {Math.round(audit.scorePct)}%
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Tag>
                  </td>
                  <td className="px-6 py-2">
                    <Tag tone={ack ? "pass" : "warn"}>{ack ? "Acknowledged" : "Needs review"}</Tag>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <>
          <div onClick={() => setOpenId(null)} className="fixed inset-0 z-40 bg-navy-900/60" aria-hidden />
          <aside role="dialog" aria-label={`${open.formLabel} audit`} className="fixed top-0 right-0 bottom-0 z-50 w-[min(460px,92vw)] overflow-y-auto border-l-2 border-ink bg-surface">
            <div className="flex items-start justify-between gap-3 border-b-2 border-ink px-6 py-5">
              <div>
                <p className="font-bold text-ink">{open.formLabel}</p>
                <p className="text-xs text-muted">
                  {formatDate(open.auditDate)} · Evaluator {open.evaluatorName}
                </p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="btn-secondary px-2.5 py-1 text-sm">
                ✕
              </button>
            </div>
            {(() => {
              const outcome = outcomeOf(open.scorePct, open.isCritical);
              const findings = failedFindings(open);
              const ack = ackOf(open);
              return (
                <div className="flex flex-col gap-5 px-6 py-5">
                  <div className="text-center">
                    <p className={`text-5xl leading-none font-extrabold tabular-nums ${SCORE_CLASS[scoreTone(open.scorePct, open.isCritical)]}`}>{Math.round(open.scorePct)}%</p>
                    <div className="mt-2">
                      <Tag tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Tag>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">Findings</p>
                    {findings.length === 0 ? (
                      <p className="mt-1 text-sm font-semibold text-pass">No findings — clean audit.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-2">
                        {findings.map((f) => (
                          <li key={f.position} className="border-2 border-line px-3 py-2 text-sm text-ink">
                            <span className="font-semibold">{f.category}:</span> {f.attribute}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">Remarks from your team lead</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{open.remarks || "No remarks left for this audit."}</p>
                  </div>

                  <button type="button" onClick={() => setShowForm((v) => !v)} className="btn-secondary px-4 py-2 text-sm">
                    {showForm ? "Hide full audit form" : "View full audit form"}
                  </button>
                  {showForm && (
                    <div className="flex flex-col gap-4">
                      {groupedResults(open).map((group) => (
                        <div key={group.name}>
                          <p className="text-sm font-bold text-ink">{group.name}</p>
                          <ul className="mt-1 divide-y-2 divide-line border-t-2 border-line">
                            {group.items.map((item) => (
                              <li key={item.position} className="flex items-center justify-between gap-3 py-1.5">
                                <span className="text-xs text-ink">{item.attribute}</span>
                                <Tag tone={item.result === "fail" ? "fail" : "pass"}>{item.result}</Tag>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {error && (
                    <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
                      {error}
                    </p>
                  )}

                  {ack ? (
                    <p className="text-sm font-semibold text-pass">✓ Acknowledged {formatStamp(ack)}</p>
                  ) : (
                    <button type="button" onClick={() => acknowledge(open)} disabled={busy} className="btn-primary px-5 py-3 text-sm disabled:opacity-50">
                      {busy ? "Saving…" : "Acknowledge review"}
                    </button>
                  )}
                </div>
              );
            })()}
          </aside>
        </>
      )}
    </>
  );
}
