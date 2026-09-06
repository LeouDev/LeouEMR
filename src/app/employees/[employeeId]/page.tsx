import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, formatWeek } from "@/components/ui";
import { canManageActionItems } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ewsAssessments, ewsIndicators, users } from "@/lib/db/schema";
import { getEmployeeMatrix } from "@/lib/queries/performance";
import { EwsPanel } from "./ews-panel";
import { ProgressMatrix } from "./progress-matrix";

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

  const matrix = await getEmployeeMatrix(user, employeeId);
  if (!matrix) notFound();

  const { employee, weeks, kpis, cells, issues } = matrix;
  const latestWeek = weeks[weeks.length - 1] ?? null;

  // The EWS assessment is recorded for a specific week, so it still needs a
  // selected one; the matrix above shows every week's risk at a glance.
  const assessmentWeek = query.week && weeks.includes(query.week) ? query.week : latestWeek;

  const indicators = await db
    .select({ code: ewsIndicators.code, label: ewsIndicators.label })
    .from(ewsIndicators)
    .where(eq(ewsIndicators.active, true))
    .orderBy(asc(ewsIndicators.sortOrder));

  const [assessment] = assessmentWeek
    ? await db
        .select({ assessment: ewsAssessments, assessorName: users.name })
        .from(ewsAssessments)
        .leftJoin(users, eq(users.id, ewsAssessments.assessedBy))
        .where(
          and(eq(ewsAssessments.employeeId, employeeId), eq(ewsAssessments.week, assessmentWeek)),
        )
        .limit(1)
    : [];

  const canAssess = canManageActionItems(user);
  const openItems = issues.filter((i) => i.status !== "COMPLETED").length;
  const failingLatest = latestWeek
    ? kpis.filter((k) => cells.get(`${k.code}|${latestWeek}`)?.status === "fail").length
    : 0;

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/employees" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Link
          href="/employees"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-navy-900 hover:underline"
        >
          ← Back to employees
        </Link>

        <div className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-navy-900">{employee.name}</h1>
            <p className="mt-1 text-sm text-muted">
              <span className="font-mono">{employee.eid}</span>
              {employee.supervisorName && <> · Supervisor: {employee.supervisorName}</>}
              {employee.managerName && <> · Manager: {employee.managerName}</>}
              {employee.site && <> · {employee.site}</>}
            </p>
          </div>
          <div className="flex gap-3 text-right">
            <div>
              <p className="font-mono text-2xl font-semibold text-navy-900">{openItems}</p>
              <p className="text-xs text-muted">active items</p>
            </div>
            <div>
              <p
                className={`font-mono text-2xl font-semibold ${
                  failingLatest > 0 ? "text-fail" : "text-pass"
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

        {assessmentWeek && (
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
                      className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition ${
                        week === assessmentWeek
                          ? "border-navy bg-navy-800 text-white"
                          : "border-line bg-surface text-muted hover:border-navy-100 hover:text-navy-900"
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
    </div>
  );
}
