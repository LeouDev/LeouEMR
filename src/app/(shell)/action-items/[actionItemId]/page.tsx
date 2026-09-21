import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { returnTo } from "@/lib/development/return-to";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, PageBand, StatusBadge, formatMetric, formatWeek } from "@/components/ui";
import { canAcknowledge, canManageActionItems } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { db } from "@/lib/db/client";
import { actionPlanCategories, rootCauseCategories } from "@/lib/db/schema";
import { SUPPORT_PLAN_LOCKED, SUPPORT_RCA_LOCKED, canRewriteRecord } from "@/lib/development/support";
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
  searchParams,
}: {
  params: Promise<{ actionItemId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const { actionItemId } = await params;
  // Where the reader came from, so "back" returns them there rather than to
  // the top of a list they were never in (see lib/development/return-to.ts).
  const back = returnTo((await searchParams).from, {
    href: "/action-items",
    label: "← All action items",
  });
  // Same reason as the employee page: a bad id is "not found", not a crash.
  if (!isUuid(actionItemId)) notFound();
  // The category list is a static reference table with no dependency on the
  // item, so it is fetched alongside it rather than after it.
  const [detail, categories, planCategories] = await Promise.all([
    getActionItemDetail(user, actionItemId),
    db
      .select({ id: rootCauseCategories.id, label: rootCauseCategories.label })
      .from(rootCauseCategories)
      .where(eq(rootCauseCategories.active, true))
      .orderBy(asc(rootCauseCategories.label)),
    // Ordered here rather than in the component: the list's order, and the
    // headings it groups under, are the table's to decide so they can be
    // changed without a deploy. The table arrives with migration 0060 and
    // the code deploys first, so a missing one costs the dropdown its
    // options and nothing else on the page.
    db
      .select({
        id: actionPlanCategories.id,
        label: actionPlanCategories.label,
        groupLabel: actionPlanCategories.groupLabel,
      })
      .from(actionPlanCategories)
      .where(eq(actionPlanCategories.active, true))
      .orderBy(asc(actionPlanCategories.sortOrder), asc(actionPlanCategories.label))
      .catch(() => []),
  ]);
  if (!detail) notFound();

  const { actionItem, issue, employee, kpi, rca, plan, history, acknowledgements, metrics, notes, timeMotion } =
    detail;
  // Handle-time work: the AHT KPI, or a handle-time skill's own item (OBD
  // Phone, PartD_Phones, Gen_Phones, UHC_west, Clinical Appeals Phone) —
  // the ones a timed observation of a call can explain.
  const isAht = isHandleTimeKpi(kpi);

  const canEdit = canManageActionItems(user);
  // A completed item is a closed record: its RCA and plan are read-only for
  // everyone, matching the server (closedRecordError in actions.ts).
  const closed = issue.status === "COMPLETED";
  const canWrite = canEdit && !closed;
  // A trainer or SME may write a record where none exists and edit their
  // own, but someone else's is read-only to them (canRewriteRecord): notes
  // go under the root cause, and only the training and coaching flags on
  // the plan are theirs to change.
  const rcaLocked = rca !== null && !canRewriteRecord(user, rca.createdBy);
  const planLocked = plan !== null && !canRewriteRecord(user, plan.createdBy);
  const reopened = issue.status === "REOPENED";
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
          href={back.href}
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {back.label}
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

        {/* A reopened item logs its passing weeks but counts none of them
            until the plan has gone back to the agent and been acknowledged.
            The enabled button alone never said so, and an item left this way
            sat with "not counted" passes until it aged out. */}
        {reopened && (
          <div className="mb-6 border-2 border-ink bg-warn-bg px-4 py-3 text-sm text-ink">
            <p className="font-semibold">Reopened after a failing week.</p>
            <p className="mt-1">
              Passing weeks are logged but do not count toward the four until{" "}
              {isOwnItem
                ? "your supervisor sends the updated plan again and you acknowledge it."
                : canEdit
                  ? "the plan is updated and sent to the agent again, and the agent acknowledges it."
                  : "the supervisor sends the updated plan again and the agent acknowledges it."}
            </p>
          </div>
        )}

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
                            ? entry.week === issue.openedWeek
                              ? "opened the item"
                              : "counter reset to 0"
                            : entry.consecutiveCountAfter === 0
                              ? "passed before the plan was acknowledged — not counted"
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
            subtitle={
              closed
                ? "Closed with the item — the record is read-only"
                : canEdit && rcaLocked
                  ? SUPPORT_RCA_LOCKED
                  : canEdit
                    ? "Required before the item can be sent to the agent"
                    : "Entered by the supervisor"
            }
            action={rca ? <Recorded /> : undefined}
          />
          <RcaForm
            actionItemId={actionItem.id}
            categories={categories}
            readOnly={!canWrite || rcaLocked}
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
            subtitle={
              closed
                ? "Closed with the item — the record is read-only"
                : canEdit && planLocked
                  ? SUPPORT_PLAN_LOCKED
                  : canEdit
                    ? "Required before the item can be sent to the agent"
                    : "Entered by the supervisor"
            }
            action={plan ? <Recorded /> : undefined}
          />
          <ActionPlanForm
            actionItemId={actionItem.id}
            readOnly={!canWrite}
            flagsOnly={canWrite && planLocked}
            categories={planCategories}
            initial={{
              categoryId: plan?.categoryId ?? "",
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

            {canEdit && (
              <SendToAgentButton
                actionItemId={actionItem.id}
                disabledReason={sendBlockedReason}
                label={reopened ? "Send to agent again" : "Send to agent"}
              />
            )}

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
