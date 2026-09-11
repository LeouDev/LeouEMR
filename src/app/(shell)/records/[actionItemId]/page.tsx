import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Card, CardHeader, PageBand, StatusBadge, formatMetric, formatWeek } from "@/components/ui";
import { canViewRecords } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { getCoachingRecordDetail } from "@/lib/queries/performance";
import { isHandleTimeKpi } from "@/lib/time-motion/engine";
import type { TimeMotionSegmentRecord } from "@/app/(shell)/action-items/[actionItemId]/time-motion";
import { Chip, includesOf } from "../includes";
import { PrintButton } from "./print-button";

const term = "text-[11px] font-bold tracking-[0.08em] text-orange-brand uppercase";

/** A labelled value in the record. An empty value prints as a dash, never as a blank the eye skips. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={term}>{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">{children || "—"}</dd>
    </div>
  );
}

/** mm:ss, the same shape the time-and-motion section on the action item uses. */
function formatSeconds(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function formatDelta(actual: number, baseline: number): { text: string; tone: string } {
  const diff = Math.round(actual - baseline);
  if (diff === 0) return { text: "on baseline", tone: "text-muted" };
  return { text: `${diff > 0 ? "+" : "−"}${formatSeconds(Math.abs(diff))}`, tone: diff > 0 ? "text-fail" : "text-pass" };
}

function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  // Fixed zone so the server and the browser print the same day.
  return date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * One coaching record, read-only and printable.
 *
 * The same sections the action-item page renders, with none of its forms
 * or actions: this page only ever reads what that workflow saved. Printing
 * (the Download PDF button) hides the header, the band, the back link and
 * the button, and keeps each section on one page where it can.
 */
export default async function RecordPage({ params }: { params: Promise<{ actionItemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (!canViewRecords(user)) redirect("/dashboard");

  const { actionItemId } = await params;
  // A bad id is "not found", not a crash — same rule as the action-item page.
  if (!isUuid(actionItemId)) notFound();

  const detail = await getCoachingRecordDetail(user, actionItemId);
  if (!detail) notFound();

  const {
    actionItem,
    issue,
    employee,
    kpi,
    rca,
    plan,
    history,
    acknowledgements,
    metrics,
    notes,
    timeMotion,
    rootCauseCategory,
    rcaBy,
    planBy,
  } = detail;

  const latestWeek = issue.lastEvaluatedWeek ?? issue.openedWeek;
  const includes = includesOf({
    hasRca: rca !== null,
    hasPlan: plan !== null,
    hasTimeMotion: timeMotion.length > 0,
    acknowledged: acknowledgements.length > 0,
    status: issue.status,
  });
  const filedBy = rcaBy ?? planBy;
  const showsTimeMotion = isHandleTimeKpi(kpi) && timeMotion.length > 0;
  const section = "mt-6 print:mt-4 print:break-inside-avoid";

  return (
    <>
      <div className="print:hidden">
        <PageBand title="Coaching record" subtitle={`${actionItem.code} · ${employee.name}`} />
      </div>

      <main className="mx-auto max-w-5xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
        <Link
          href="/records"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline print:hidden"
        >
          ← All records
        </Link>

        <header className="mt-4 mb-6 print:mt-0 print:break-inside-avoid">
          <p className={term}>Coaching record</p>
          <h1 className="mt-1 text-[28px] leading-tight font-extrabold tracking-[-0.01em] text-ink">
            {employee.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {kpi.name} · {actionItem.code} · week of {formatWeek(latestWeek)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={issue.status} />
            {includes.map((chip) => (
              <Chip key={chip}>{chip}</Chip>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Created by: <span className="text-ink">{filedBy ?? "—"}</span>
            {" · "}Opened week of {formatWeek(issue.openedWeek)}
            {" · "}
            {issue.consecutivePassingWeeks} / 4 consecutive passing weeks
          </p>
        </header>

        <Card className="print:break-inside-avoid">
          <CardHeader title="Weekly timeline" subtitle="Every week this issue has been evaluated" />
          <div className="px-6 py-5">
            {history.length === 0 ? (
              <p className="text-sm text-muted">No weeks recorded.</p>
            ) : (
              <ol className="divide-y-2 divide-line">
                {history.map((entry) => {
                  const metric = metrics.find((m) => m.weekStart === entry.week);
                  return (
                    <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span className="text-ink">
                        {formatWeek(entry.week)}
                        {metric && (
                          <span className="ml-2 text-xs text-muted">
                            {formatMetric(metric.actualValue, kpi.code)} against {formatMetric(metric.targetValue, kpi.code)}
                          </span>
                        )}
                      </span>
                      <span className={`font-semibold ${entry.result === "fail" ? "text-fail" : "text-pass"}`}>
                        {entry.result === "fail" ? "FAIL" : `PASS · monitoring ${entry.consecutiveCountAfter} / 4`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        <Card className={section}>
          <CardHeader title="Root cause analysis" subtitle={rcaBy ? `Entered by ${rcaBy}` : "Entered by the supervisor"} />
          {rca ? (
            <dl className="space-y-4 px-6 py-5">
              <Field label="Problem statement">{rca.problemStatement}</Field>
              <Field label="Root cause category">{rootCauseCategory}</Field>
              <Field label="Root cause details">{rca.rootCauseDetails}</Field>
              <Field label="Contributing factors">{rca.contributingFactors}</Field>
              <Field label="Evidence / notes">{rca.evidenceNotes}</Field>
            </dl>
          ) : (
            <p className="px-6 py-5 text-sm text-muted">No RCA recorded.</p>
          )}
        </Card>

        {notes.length > 0 && (
          <Card className={section}>
            <CardHeader
              title="Notes on the root cause"
              subtitle="How the circumstances changed, week by week"
              action={
                <span className="text-xs font-semibold text-muted">
                  {notes.length} note{notes.length === 1 ? "" : "s"}
                </span>
              }
            />
            <ul className="divide-y-2 divide-line">
              {notes.map((n) => (
                <li key={n.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={term}>{formatWeek(n.week)}</span>
                    <span className="text-xs text-muted">
                      {n.authorName ?? "Unknown"} · {formatDate(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink">{n.note}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {showsTimeMotion && (
          <Card className={section}>
            <CardHeader
              title="Time & motion"
              subtitle="Which part of the call is actually driving the handle time, timed against a baseline"
              action={
                <span className="text-xs font-semibold text-muted">
                  {timeMotion.length} stud{timeMotion.length === 1 ? "y" : "ies"}
                </span>
              }
            />
            <div className="divide-y-2 divide-line">
              {timeMotion.map((study) => {
                const segments = study.segments as TimeMotionSegmentRecord[];
                const total = formatDelta(study.totalActualSeconds, study.totalBaselineSeconds);
                return (
                  <div key={study.id} className="px-6 py-5 print:break-inside-avoid">
                    <p className="text-sm text-ink">
                      {study.callReference ? (
                        <span className="font-mono">{study.callReference}</span>
                      ) : (
                        "Call not referenced"
                      )}
                      <span className="ml-2 text-xs text-muted">{formatDate(study.createdAt)}</span>
                    </p>
                    <table className="mt-3 w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b-2 border-ink">
                          <th className="py-1.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Segment</th>
                          <th className="py-1.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Baseline</th>
                          <th className="py-1.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Actual</th>
                          <th className="py-1.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((s) => {
                          const delta = formatDelta(s.actualSeconds, s.baselineSeconds);
                          return (
                            <tr key={s.code} className="border-b border-line">
                              <td className="py-1.5 text-ink">{s.label}</td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-muted">{formatSeconds(s.baselineSeconds)}</td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-ink">{formatSeconds(s.actualSeconds)}</td>
                              <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${delta.tone}`}>{delta.text}</td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td className="py-2 font-bold text-ink">Total</td>
                          <td className="py-2 text-right font-mono font-bold tabular-nums text-muted">{formatSeconds(study.totalBaselineSeconds)}</td>
                          <td className="py-2 text-right font-mono font-bold tabular-nums text-ink">{formatSeconds(study.totalActualSeconds)}</td>
                          <td className={`py-2 text-right font-mono font-bold tabular-nums ${total.tone}`}>{total.text}</td>
                        </tr>
                      </tbody>
                    </table>
                    {study.remarks && <p className="mt-3 text-sm text-muted">{study.remarks}</p>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card className={section}>
          <CardHeader title="Action plan" subtitle={planBy ? `Entered by ${planBy}` : "Entered by the supervisor"} />
          {plan ? (
            <dl className="space-y-4 px-6 py-5">
              <Field label="Corrective action">{plan.correctiveAction}</Field>
              <Field label="Expected behavior">{plan.expectedBehavior}</Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Target">{`${plan.targetMetric} → ${plan.targetValue}`}</Field>
                <Field label="Due date">{formatDate(plan.dueDate)}</Field>
                <Field label="Follow-up">{formatDate(plan.followUpDate)}</Field>
              </div>
              <Field label="Support">
                {[plan.coachingRequired && "Coaching", plan.trainingRequired && "Training"].filter(Boolean).join(", ") || "None"}
              </Field>
              <Field label="Supervisor notes">{plan.supervisorNotes}</Field>
            </dl>
          ) : (
            <p className="px-6 py-5 text-sm text-muted">No action plan recorded.</p>
          )}
        </Card>

        <Card className={section}>
          <CardHeader title="Acknowledgement" />
          <div className="px-6 py-5 text-sm">
            {acknowledgements.length > 0 ? (
              <ul className="space-y-1 text-ink">
                {acknowledgements.map((ack) => (
                  <li key={ack.id}>
                    Acknowledged on{" "}
                    {ack.acknowledgedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">
                {issue.status === "AWAITING_AGENT_ACKNOWLEDGEMENT"
                  ? "Awaiting agent acknowledgement."
                  : "Not yet sent to the agent."}
              </p>
            )}
          </div>
        </Card>

        <div className="mt-10 flex justify-end print:hidden">
          <PrintButton />
        </div>
      </main>
    </>
  );
}
