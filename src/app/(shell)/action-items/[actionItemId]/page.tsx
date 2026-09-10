import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, PageBand, StatusBadge, formatMetric, formatWeek } from "@/components/ui";
import { canAcknowledge, canManageActionItems } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { db } from "@/lib/db/client";
import { rootCauseCategories } from "@/lib/db/schema";
import { getActionItemDetail } from "@/lib/queries/performance";
import { AcknowledgeButton, ActionPlanForm, RcaForm, SendToAgentButton } from "./workflow";
import { RcaNotes } from "./rca-notes";
import { isHandleTimeKpi } from "@/lib/time-motion/engine";
import { TimeMotionSection } from "./time-motion";
import type { TimeMotionSegmentRecord } from "./time-motion";

/** Marks a section as filled in. Not a verdict on the agent's performance. */
function Recorded() {
  return (
    <span className="inline-block bg-pass-bg px-2 py-1 text-[11px] font-bold tracking-[0.08em] text-pass uppercase">
      Recorded
    </span>
  );
}

export default async function ActionItemPage({
  params,
}: {
  params: Promise<{ actionItemId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const { actionItemId } = await params;
  // Same reason as the employee page: a bad id is "not found", not a crash.
  if (!isUuid(actionItemId)) notFound();
  // The category list is a static reference table with no dependency on the
  // item, so it is fetched alongside it rather than after it.
  const [detail, categories] = await Promise.all([
    getActionItemDetail(user, actionItemId),
    db
      .select({ id: rootCauseCategories.id, label: rootCauseCategories.label })
      .from(rootCauseCategories)
      .where(eq(rootCauseCategories.active, true))
      .orderBy(asc(rootCauseCategories.label)),
  ]);
  if (!detail) notFound();

  const { actionItem, issue, employee, kpi, rca, plan, history, acknowledgements, metrics, notes, timeMotion } =
    detail;
  // Handle-time work: the AHT KPI, or a handle-time skill's own item (OBD
  // Phone, PartD_Phones, Gen_Phones, UHC_west, Clinical Appeals Phone) —
  // the ones a timed observation of a call can explain.
  const isAht = isHandleTimeKpi(kpi);

  const canEdit = canManageActionItems(user);
  const isOwnItem = user.employeeEid !== null && employee.eid === user.employeeEid;
  const canAck =
    canAcknowledge(user) && isOwnItem && issue.status === "AWAITING_AGENT_ACKNOWLEDGEMENT";

  const sendBlockedReason =
    issue.status !== "OPEN" && issue.status !== "REOPENED"
      ? `Already ${issue.status.toLowerCase().replace(/_/g, " ")}`
      : !rca
        ? "Enter the RCA first"
        : !plan
          ? "Enter the action plan first"
          : null;

  return (
    <>
      {/* The same navy band every list page opens with. Without it the
          shell's loading skeleton (which always draws one) flashed a band
          for the click and then snapped the content up when this page
          arrived without one — the one place in the app a navigation
          visibly jumped. */}
      <PageBand title={kpi.name} subtitle={`${actionItem.code} · ${employee.name}`} />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link
          href="/action-items"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← All action items
        </Link>

        <div className="mt-4 mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={issue.status} />
            </div>
            <p className="mt-2 text-sm text-muted">
              <Link
                href={`/employees/${employee.id}`}
                prefetch={false}
                className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
              >
                {employee.name}
              </Link>{" "}
              · Opened week of {formatWeek(issue.openedWeek)}
            </p>
          </div>

          <div className="text-right">
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
              {issue.consecutivePassingWeeks} / 4
            </p>
            <p className="text-xs text-muted">consecutive passing weeks</p>
          </div>
        </div>

        <Card>
          <CardHeader title="Weekly timeline" subtitle="Every week this issue has been evaluated" />
          <div className="px-6 py-5">
            {history.length === 0 ? (
              <p className="text-sm text-muted">No weeks recorded yet.</p>
            ) : (
              <ol className="space-y-0">
                {history.map((entry, index) => {
                  const metric = metrics.find((m) => m.weekStart === entry.week);
                  return (
                    <li key={entry.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 h-3 w-3 shrink-0 ${entry.result === "fail" ? "bg-fail" : "bg-pass"
                          }`}
                        />
                        {index < history.length - 1 && <span className="w-px flex-1 bg-line" />}
                      </div>
                      <div className="pb-5">
                        <p className="text-sm font-medium text-ink">
                          {formatWeek(entry.week)}{" "}
                          <span className={entry.result === "fail" ? "text-fail" : "text-pass"}>
                            {entry.result === "fail" ? "FAIL" : "PASS"}
                          </span>
                        </p>
                        <p className="text-xs text-muted">
                          {metric
                            ? `${formatMetric(metric.actualValue, kpi.code)} against ${formatMetric(
                                metric.targetValue,
                                kpi.code,
                              )} · `
                            : ""}
                          {entry.result === "fail"
                            ? "counter reset to 0"
                            : `monitoring ${entry.consecutiveCountAfter} / 4`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        {isAht && (
          <Card className="mt-6">
            <CardHeader
              title="Time & motion"
              subtitle="Which part of the call is actually driving the handle time, timed against a baseline"
              action={
                timeMotion.length > 0 ? (
                  <span className="text-xs font-semibold text-muted">
                    {timeMotion.length} stud{timeMotion.length === 1 ? "y" : "ies"}
                  </span>
                ) : undefined
              }
            />
            <TimeMotionSection
              actionItemId={actionItem.id}
              canRecord={canEdit}
              studies={timeMotion.map((s) => ({
                id: s.id,
                callReference: s.callReference,
                segments: s.segments as TimeMotionSegmentRecord[],
                totalActualSeconds: s.totalActualSeconds,
                totalBaselineSeconds: s.totalBaselineSeconds,
                remarks: s.remarks,
                createdAt: s.createdAt,
              }))}
            />
          </Card>
        )}

        <Card className="mt-6">
          <CardHeader
            title="Root cause analysis"
            subtitle={canEdit ? "Required before the item can be sent to the agent" : "Entered by the supervisor"}
            action={rca ? <Recorded /> : undefined}
          />
          <RcaForm
            actionItemId={actionItem.id}
            categories={categories}
            readOnly={!canEdit}
            initial={{
              problemStatement: rca?.problemStatement ?? "",
              rootCauseCategoryId: rca?.rootCauseCategoryId ?? "",
              rootCauseDetails: rca?.rootCauseDetails ?? "",
              contributingFactors: rca?.contributingFactors ?? "",
              evidenceNotes: rca?.evidenceNotes ?? "",
            }}
          />
        </Card>

        {rca && (
          <Card className="mt-6">
            <CardHeader
              title="Notes on the root cause"
              subtitle="How the circumstances changed, week by week. The RCA above stays as the underlying explanation."
              action={
                notes.length > 0 ? (
                  <span className="text-xs font-semibold text-muted">
                    {notes.length} note{notes.length === 1 ? "" : "s"}
                  </span>
                ) : undefined
              }
            />
            <RcaNotes
              actionItemId={actionItem.id}
              notes={notes}
              weeks={[...history].map((h) => h.week).reverse()}
              canAdd={canEdit}
            />
          </Card>
        )}

        <Card className="mt-6">
          <CardHeader
            title="Action plan"
            subtitle={canEdit ? "Required before the item can be sent to the agent" : "Entered by the supervisor"}
            action={plan ? <Recorded /> : undefined}
          />
          <ActionPlanForm
            actionItemId={actionItem.id}
            readOnly={!canEdit}
            initial={{
              correctiveAction: plan?.correctiveAction ?? "",
              expectedBehavior: plan?.expectedBehavior ?? "",
              targetMetric: plan?.targetMetric ?? kpi.name,
              targetValue: plan?.targetValue !== undefined && plan?.targetValue !== null ? String(plan.targetValue) : "",
              dueDate: plan?.dueDate ?? "",
              followUpDate: plan?.followUpDate ?? "",
              coachingRequired: plan?.coachingRequired ?? false,
              trainingRequired: plan?.trainingRequired ?? false,
              supervisorNotes: plan?.supervisorNotes ?? "",
            }}
          />
        </Card>

        <Card className="mt-6">
          <CardHeader
            title="Acknowledgement"
            subtitle={
              acknowledgements.length > 0
                ? `Acknowledged ${acknowledgements.length} time${acknowledgements.length === 1 ? "" : "s"}`
                : "The agent must acknowledge before monitoring begins"
            }
          />
          <div className="space-y-4 px-6 py-5">
            {acknowledgements.length > 0 && (
              <ul className="space-y-1 text-sm text-ink">
                {acknowledgements.map((ack) => (
                  <li key={ack.id}>
                    Acknowledged on{" "}
                    {ack.acknowledgedAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </li>
                ))}
              </ul>
            )}

            {canAck && <AcknowledgeButton actionItemId={actionItem.id} />}

            {canEdit && <SendToAgentButton actionItemId={actionItem.id} disabledReason={sendBlockedReason} />}

            {!canEdit && !canAck && acknowledgements.length === 0 && (
              <p className="text-sm text-muted">
                {issue.status === "AWAITING_AGENT_ACKNOWLEDGEMENT"
                  ? "Waiting for the agent to acknowledge."
                  : "Nothing to acknowledge yet."}
              </p>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
