import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand } from "@/components/ui";
import { isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { isUuid } from "@/lib/ids";
import { eligibleForPeriod } from "@/lib/queries/eligibility";
import { joinPeriodOwner, periodOwnerSubquery, reportingScopeIds, supervisorOfRecord } from "@/lib/queries/org-history";
import { periodsBetween, type Period } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import { getScorecardFor } from "@/lib/scorecard/load";
import { canReview, monthStartOf, reviewOpensOn, todayInManila } from "@/lib/scorecard/review";
import { signedAt } from "@/lib/scorecard/signature";
import { PrintButton } from "@/app/(shell)/records/[actionItemId]/print-button";
import { ScorecardPickers } from "./pickers";
import { ScorecardTable } from "./scorecard-table";
import { SignatureImage } from "./signature-image";
import { AcknowledgeButton, ReviewButton } from "./stamps";

function longDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * Who can be picked for a month: the people whose results belonged to this
 * leader THAT month — whoever held them for most of it, by assignment
 * history, the way every period view scopes — and who had not left before
 * it. Today's roster would show a leader only the people linked to them
 * now, and keep listing someone who left in July on August's card. An
 * agent is always just themselves.
 */
async function rosterFor(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  month: Period,
): Promise<Array<{ id: string; name: string; supervisorName: string | null }>> {
  if (user.role === "agent") {
    if (!user.employeeEid) return [];
    return db
      .select({ id: employees.id, name: employees.name, supervisorName: employees.supervisorName })
      .from(employees)
      .where(eq(employees.eid, user.employeeEid))
      .limit(1);
  }
  const scoped = await reportingScopeIds(user, month);
  const eligible = await eligibleForPeriod(scoped, month);
  if (eligible.length === 0) return [];
  const owner = periodOwnerSubquery(month);
  return db
    .select({ id: employees.id, name: employees.name, supervisorName: supervisorOfRecord(owner) })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(inArray(employees.id, eligible))
    .orderBy(asc(employees.name));
}

/**
 * The monthly scorecard. An agent sees their own; a team leader picks
 * someone on their team and signs the month off once it opens; a manager
 * or administrator reads their span. Trainers and SMEs have no scorecard
 * to read.
 */
export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (isSupportRole(user)) redirect("/dashboard");

  const isAgent = user.role === "agent";
  const [params, range] = await Promise.all([searchParams, getFactDateRange()]);
  const today = todayInManila();

  // Every month from the first fact to today, newest first: the current
  // month is on the list as a running month-to-date card even before its
  // first upload of the month.
  const months = range ? periodsBetween("month", range.first, today > range.last ? today : range.last) : [];
  const month = months.find((m) => m.start === params.month) ?? months[0] ?? null;

  const people = month ? await rosterFor(user, month) : [];

  const employeeId = isAgent
    ? (people[0]?.id ?? null)
    : (people.find((p) => p.id === (isUuid(params.employee) ? params.employee : ""))?.id ?? people[0]?.id ?? null);

  const band = (
    <PageBand
      title={isAgent ? "My Scorecard" : "Scorecard"}
      subtitle={
        isAgent
          ? "Your monthly scorecard, and the acknowledgement your team leader needs"
          : user.role === "supervisor"
            ? "Each person's monthly scorecard, reviewed by you once the month's data has landed"
            : "Monthly scorecards across your span"
      }
      action={
        month ? (
          <ScorecardPickers
            people={isAgent ? [] : people}
            employeeId={employeeId}
            months={months.map((m) => ({ start: m.start, label: m.label }))}
            month={month.start}
          />
        ) : undefined
      }
    />
  );

  if (!month || !employeeId) {
    return (
      <>
        {band}
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title={isAgent ? "Account not linked" : "No scorecard to show"}
              description={
                isAgent
                  ? "An administrator needs to link this account to an employee ID before your scorecard appears here."
                  : "Nobody was on your team this month, or no performance data has been imported yet. Pick another month above."
              }
            />
          </Card>
        </main>
      </>
    );
  }

  const data = await getScorecardFor(employeeId, month.start);
  if (!data) {
    return (
      <>
        {band}
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState title="No scorecard to show" description="This person is not in the roster." />
          </Card>
        </main>
      </>
    );
  }

  const { employee, card, review } = data;
  const current = monthStartOf(today) === month.start;
  const opensOn = reviewOpensOn(month.start);
  const reviewable = canReview(month.start, today);
  const topSkill = [...(card.rows[0].skills ?? [])].sort((a, b) => b.hours - a.hours)[0] ?? null;
  const processType =
    card.hours.phone + card.hours.ancillary === 0
      ? "—"
      : card.hours.phoneShare > 0.5
        ? "Phone"
        : card.hours.ancillaryShare > 0.5
          ? "Ancillary"
          : "Mixed";

  const reviewDisabled = !reviewable
    ? `Opens for review on ${longDate(opensOn)}`
    : review && !review.changedSinceReview
      ? `Reviewed by ${review.reviewedByName ?? "the team leader"}, ${signedAt(review.reviewedAt)}`
      : null;
  const acknowledgeDisabled = !review
    ? "Your team leader reviews the month first"
    : review.acknowledgedAt
      ? `Acknowledged ${signedAt(review.acknowledgedAt)}`
      : review.changedSinceReview
        ? "The card changed since it was reviewed — your team leader will review it again"
        : null;

  return (
    <>
      {/* Thirteen columns need the page on its side, and a zero page margin
          is what stops the browser printing its own title and URL lines;
          the main below carries the margin instead. */}
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } }`}</style>
      <div className="print:hidden">{band}</div>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8 print:max-w-none print:space-y-2 print:p-[7mm]">
        {review?.changedSinceReview && (
          <div className="border-2 border-ink bg-warn-bg px-4 py-3 text-sm text-ink print:hidden">
            <p className="font-semibold">Changed since it was reviewed.</p>
            <p className="mt-1">
              A later import moved this card from {review.reviewedScore === null ? "no score" : review.reviewedScore.toFixed(2)} to{" "}
              {card.finalScore === null ? "no score" : card.finalScore.toFixed(2)}. The review stamp stands; the team leader
              can review it again, which asks the agent to acknowledge it again.
            </p>
          </div>
        )}

        <Card className="print:break-inside-avoid">
          {/* Compact on paper so the card and its acknowledgement share one landscape page. */}
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 print:px-4 print:py-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm print:gap-y-0 print:text-xs">
              <dt className="font-semibold text-muted">Employee ID</dt>
              <dd className="font-mono text-ink">{employee.eid}</dd>
              <dt className="font-semibold text-muted">Employee name</dt>
              <dd className="font-semibold text-ink">{employee.name}</dd>
              <dt className="font-semibold text-muted">Supervisor</dt>
              <dd className="text-ink">{employee.supervisorName ?? "—"}</dd>
              <dt className="font-semibold text-muted">Process name</dt>
              <dd className="text-ink">{topSkill ? `Prior Authorization - ${topSkill.name}` : "—"}</dd>
              <dt className="font-semibold text-muted">Process type</dt>
              <dd className="text-ink">{processType}</dd>
            </dl>
            <div className="text-right">
              <p className="text-2xl font-extrabold tracking-[-0.01em] text-ink print:text-lg">{month.label}</p>
              <p className="mt-1 text-xs text-muted">
                {current ? "Running month to date" : "Full month"} · Optum Rx prior authorization scorecard
              </p>
              <p className="mt-3 font-mono text-4xl font-bold tabular-nums text-ink print:mt-1 print:text-2xl">
                {card.finalScore === null ? "--" : card.finalScore.toFixed(2)}
              </p>
              <p className="text-xs text-muted">final score out of 5</p>
            </div>
          </div>
          <ScorecardTable card={card} />
        </Card>

        <Card className="print:break-inside-avoid">
          <CardHeader
            title="Acknowledgement"
            subtitle="I acknowledge that performance goals and their definitions were clearly discussed to me by my Immediate Manager."
          />
          <div className="grid gap-6 px-6 py-5 sm:grid-cols-2 print:gap-4 print:px-4 print:py-2">
            <div>
              {/* The drawn signature sits on the line, the way it would on the printed sheet. */}
              <div className="flex h-20 items-end print:h-12">
                {review?.acknowledgedSignature ? (
                  <SignatureImage signature={review.acknowledgedSignature} className="h-20 w-auto max-w-full text-ink print:h-12" />
                ) : null}
              </div>
              <p className="border-b-2 border-ink pb-1 text-base font-semibold text-ink">{employee.name}</p>
              <p className="mt-1 text-xs font-bold tracking-[0.06em] text-muted uppercase">Employee name &amp; signature</p>
              <p className="mt-1 text-sm text-ink">
                {review?.acknowledgedAt ? `Signed ${signedAt(review.acknowledgedAt)}` : "Not yet acknowledged"}
              </p>
              {isAgent && (
                <div className="mt-3 print:hidden">
                  <AcknowledgeButton month={month.start} monthLabel={month.label} disabledReason={acknowledgeDisabled} />
                </div>
              )}
            </div>
            <div>
              <div className="flex h-20 items-end print:h-12">
                {review?.reviewedSignature ? (
                  <SignatureImage signature={review.reviewedSignature} className="h-20 w-auto max-w-full text-ink print:h-12" />
                ) : null}
              </div>
              <p className="border-b-2 border-ink pb-1 text-base font-semibold text-ink">
                {review?.reviewedByName ?? employee.supervisorName ?? "—"}
              </p>
              <p className="mt-1 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                Immediate manager name &amp; signature
              </p>
              <p className="mt-1 text-sm text-ink">
                {review ? `Signed ${signedAt(review.reviewedAt)}` : `Not yet reviewed · opens ${longDate(opensOn)}`}
              </p>
              {user.role === "supervisor" && (
                <div className="mt-3 print:hidden">
                  <ReviewButton
                    employeeId={employee.id}
                    employeeName={employee.name}
                    month={month.start}
                    monthLabel={month.label}
                    disabledReason={reviewDisabled}
                    label={review ? "Review again" : "Mark as reviewed"}
                  />
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex justify-end print:hidden">
          <PrintButton />
        </div>
      </main>
    </>
  );
}
