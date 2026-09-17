"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OUTCOME_LABELS, outcomeOf, type QaOutcome } from "@/lib/quality/scoring";
import { headerRows } from "@/lib/quality/header-values";
import { formatDelta } from "@/lib/quality/time-motion";
import type { QaHistoryRow } from "@/lib/queries/quality";
import { Tag } from "../quality-tabs";

const OUTCOME_TONE: Record<QaOutcome, "pass" | "warn" | "fail"> = {
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

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Past audits, and a drawer with one audit's detail and its own raw-data download. */
export function HistoryTable({ rows }: { rows: QaHistoryRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Agent</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Form</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Audited</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Transaction</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Evaluator</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Score</th>
              <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const outcome = outcomeOf(row.scorePct, row.isCritical);
              return (
                <tr
                  key={row.id}
                  onClick={() => setOpenId(row.id)}
                  className="cursor-pointer border-b-2 border-line last:border-0 hover:bg-orange-brand-100"
                >
                  <td className="px-6 py-2 font-semibold text-ink">{row.agentName}</td>
                  <td className="px-3 py-2 text-ink">{row.formLabel}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{formatDate(row.auditDate)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{row.transactionDate ? formatDate(row.transactionDate) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {row.evaluatorName}
                    {!row.countsForRequirement && <span className="ml-1.5 text-[10px] font-bold tracking-[0.06em] uppercase">· support</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-sm font-bold tabular-nums ${SCORE_COLOR[outcome]}`}>{Math.round(row.scorePct)}%</td>
                  <td className="px-6 py-2">
                    <Tag tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Tag>
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
          <aside
            role="dialog"
            aria-label={`Audit of ${open.agentName}`}
            className="fixed top-0 right-0 bottom-0 z-50 w-[min(440px,92vw)] overflow-y-auto border-l-2 border-ink bg-surface"
          >
            <div className="flex items-start justify-between gap-3 border-b-2 border-ink px-6 py-5">
              <div>
                <Link href={`/employees/${open.agentId}`} prefetch={false} className="font-bold text-ink underline-offset-4 hover:text-orange-brand hover:underline">
                  {open.agentName}
                </Link>
                <p className="text-xs text-muted">
                  {open.formLabel} · Audited {formatDate(open.auditDate)}
                  {open.transactionDate && ` · Transaction ${formatDate(open.transactionDate)}`}
                </p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="btn-secondary px-2.5 py-1 text-sm">
                ✕
              </button>
            </div>
            {(() => {
              const outcome = outcomeOf(open.scorePct, open.isCritical);
              // Through headerRows, so an audit filed when this form asked a
              // different header still shows what it recorded.
              const details = headerRows(open.headerFields, open.headerValues);
              return (
                <div className="flex flex-col gap-5 px-6 py-5">
                  <div className="text-center">
                    <p className={`text-5xl leading-none font-extrabold tabular-nums ${SCORE_COLOR[outcome]}`}>{Math.round(open.scorePct)}%</p>
                    <div className="mt-2">
                      <Tag tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Tag>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">Evaluator</p>
                    <p className="mt-1 text-sm text-ink">{open.evaluatorName}</p>
                  </div>
                  {details.length > 0 && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      {details.map((d) => (
                        <div key={d.label} className="contents">
                          <dt className="text-xs font-semibold text-muted uppercase">{d.label}</dt>
                          <dd className="text-ink">{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">Remarks</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{open.remarks || "—"}</p>
                  </div>
                  {open.timeMotion && (
                    <div>
                      <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">
                        Time &amp; Motion{open.timeMotion.callReference ? ` · ${open.timeMotion.callReference}` : ""}
                      </p>
                      <ul className="mt-1 divide-y-2 divide-line border-t-2 border-line text-sm">
                        {open.timeMotion.segments.map((seg) => {
                          const delta = seg.actualSeconds - seg.baselineSeconds;
                          return (
                            <li key={seg.label} className="flex items-center justify-between gap-3 py-1.5">
                              <span className="text-ink">{seg.label}</span>
                              <span className="font-mono text-xs tabular-nums text-muted">
                                {seg.actualSeconds}s / {seg.baselineSeconds}s{" "}
                                <span className={delta > 0 ? "text-fail" : "text-pass"}>{formatDelta(delta)}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-orange-brand uppercase">Agent acknowledgement</p>
                    <p className={`mt-1 text-sm ${open.acknowledgedAt ? "text-pass" : "text-muted"}`}>
                      {open.acknowledgedAt
                        ? `Acknowledged ${new Date(open.acknowledgedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : "Not yet acknowledged"}
                    </p>
                  </div>
                  <a href={`/quality/export?audit=${open.id}`} className="btn-secondary inline-block px-4 py-2 text-center text-sm">
                    Download raw data (CSV)
                  </a>
                </div>
              );
            })()}
          </aside>
        </>
      )}
    </>
  );
}
