import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, formatWeek } from "@/components/ui";
import { canManageActionItems } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ewsAssessments, ewsIndicators, users } from "@/lib/db/schema";
import { getEmployeeMatrix } from "@/lib/queries/performance";
import { getEmployeeSkillBreakdown } from "@/lib/queries/skill-breakdown";
import { EwsPanel } from "./ews-panel";
import { ProgressMatrix } from "./progress-matrix";
import { SkillBreakdownTable } from "./skill-breakdown-table";

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const { employeeId } = await params;
  const query = await searchParams;

  // The indicator list is a static reference table with no dependency on the
  // matrix, so it is fetched alongside it rather than after it.
  const [matrix, indicators] = await Promise.all([
    getEmployeeMatrix(user, employeeId),
    db
      .select({ code: ewsIndicators.code, label: ewsIndicators.label })
      .from(ewsIndicators)
      .where(eq(ewsIndicators.active, true))
      .orderBy(asc(ewsIndicators.sortOrder)),
  ]);
  if (!matrix) notFound();

  const { employee, weeks, kpis, cells, issues } = matrix;
  const latestWeek = weeks[weeks.length - 1] ?? null;

  // The EWS assessment is recorded for a specific week, so it still needs a
  // selected one; the matrix above shows every week's risk at a glance.
  const assessmentWeek = query.week && weeks.includes(query.week) ? query.week : latestWeek;

  const [assessmentRows, skillBreakdown] = await Promise.all([
    assessmentWeek
      ? db
          .select({ assessment: ewsAssessments, assessorName: users.name })
          .from(ewsAssessments)
          .leftJoin(users, eq(users.id, ewsAssessments.assessedBy))
          .where(
            and(eq(ewsAssessments.employeeId, employeeId), eq(ewsAssessments.week, assessmentWeek)),
          )
          .limit(1)
      : Promise.resolve([]),
    getEmployeeSkillBreakdown(employeeId, employee.eid, weeks),
  ]);
  const [assessment] = assessmentRows;

  const canAssess = canManageActionItems(user);
  // Early warning signs are the supervisor's own read on flight risk and
  // coachability — notes written about the agent, not for them. Leaders see
  // them on anyone's page; an agent opening their own page does not.
  const showsEws = user.role !== "agent";
  const openItems = issues.filter((i) => i.status !== "COMPLETED").length;
  const failingLatest = latestWeek
    ? kpis.filter((k) => cells.get(`${k.code}|${latestWeek}`)?.status === "fail").length
    : 0;

  return (
    <>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Link
          href="/employees"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Back to employees
        </Link>

        <div className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{employee.name}</h1>
            <p className="mt-1 text-sm text-muted">
              <span className="font-mono">{employee.eid}</span>
              {employee.supervisorName && <> · Supervisor: {employee.supervisorName}</>}
              {employee.managerName && <> · Manager: {employee.managerName}</>}
              {employee.site && <> · {employee.site}</>}
            </p>
          </div>
          <div className="flex gap-3 text-right">
            <div>
              <p className="font-mono text-2xl font-semibold text-ink">{openItems}</p>
              <p className="text-xs text-muted">active items</p>
            </div>
            <div>
              <p
                className={`font-mono text-2xl font-semibold ${failingLatest > 0 ? "text-fail" : "text-pass"
                }`}
              >
                {failingLatest}
              </p>
              <p className="text-xs text-muted">failing latest week</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Development plan"
            subtitle={
              weeks.length > 0
                ? `${weeks.length} weeks, ${formatWeek(weeks[0])} to ${formatWeek(weeks[weeks.length - 1])} — scroll sideways for the full history`
                : "No weeks imported"
            }
          />
          <ProgressMatrix matrix={matrix} />
        </Card>

        {skillBreakdown.length > 0 && (
          <Card className="mt-6">
            <CardHeader
              title="Skill breakdown"
              subtitle="What actually fed the KPIs above, one skill at a time — a blended figure like Cases Per Hour sums every contributing skill into one number, so this is the only place to see them apart"
            />
            <SkillBreakdownTable rows={skillBreakdown} weeks={weeks} />
          </Card>
        )}

        {assessmentWeek && showsEws && (
          <Card className="mt-6">
            <CardHeader
              title="Early warning signs"
              subtitle={
                canAssess
                  ? `Supervisor judgement for the week of ${formatWeek(assessmentWeek)} — these cannot be derived from the performance data`
                  : `Recorded by the supervisor for the week of ${formatWeek(assessmentWeek)}`
              }
              action={
                <div className="flex flex-wrap gap-1.5">
                  {weeks.slice(-6).map((week) => (
                    <Link
                      key={week}
                      href={`/employees/${employeeId}?week=${week}`}
                      prefetch={false}
                      // Stay put. This panel sits near the bottom of a long
                      // page, and the default jump to the top meant scrolling
                      // back down after every week you looked at.
                      scroll={false}
                      className={`border px-2 py-0.5 text-xs font-medium transition ${
                        week === assessmentWeek
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-surface text-muted hover:border-orange-brand hover:text-ink"
                      }`}
                    >
                      {formatWeek(week)}
                    </Link>
                  ))}
                </div>
              }
            />
            <EwsPanel
              employeeId={employeeId}
              week={assessmentWeek}
              indicators={indicators}
              readOnly={!canAssess}
              assessedByName={assessment?.assessorName ?? null}
              initial={{
                indicators: (assessment?.assessment.indicators as Record<string, boolean>) ?? {},
                capActive: assessment?.assessment.capActive ?? false,
                attrition: assessment?.assessment.attrition ?? "none",
                attritionDate: assessment?.assessment.attritionDate ?? "",
                notes: assessment?.assessment.notes ?? "",
              }}
            />
          </Card>
        )}
      </main>
    </>
  );
}
