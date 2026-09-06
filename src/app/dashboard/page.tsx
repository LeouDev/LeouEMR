import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardHeader,
  EmptyState,
  StatCard,
  StatusBadge,
  formatMetric,
  formatWeek,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getAttentionRows,
  getAvailableWeeks,
  getLatestWeek,
  getTeamSummary,
} from "@/lib/queries/performance";
import { getOverdueCount, getSupervisorRollup } from "@/lib/queries/roster";

/** Today's date as YYYY-MM-DD, for overdue comparisons. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const ROLE_HEADLINE: Record<string, string> = {
  admin: "Organization overview",
  manager: "My organization",
  supervisor: "My team",
  agent: "My performance",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const weeks = await getAvailableWeeks();
  const latest = await getLatestWeek();
  const week = params.week && weeks.includes(params.week) ? params.week : latest;

  const summary = await getTeamSummary(user, week);
  const attention = await getAttentionRows(user, week, 50);

  // Managers and admins get a per-supervisor breakdown; supervisors and
  // agents have no one below them to roll up.
  const showsRollup = user.role === "manager" || user.role === "admin";
  const rollup = showsRollup ? await getSupervisorRollup(user, week) : [];
  const overdue = await getOverdueCount(user, todayIso());

  const unscoped = user.role !== "admin" && !user.employeeEid && user.role !== "manager";

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/dashboard" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-navy-900">
              {ROLE_HEADLINE[user.role] ?? "Dashboard"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {week ? `Week of ${formatWeek(week)}` : "No performance data imported yet"}
            </p>
          </div>

          {weeks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {weeks.slice(0, 6).map((option) => (
                <Link
                  key={option}
                  href={`/dashboard?week=${option}`}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    option === week
                      ? "border-navy bg-navy-800 text-white"
                      : "border-line bg-surface text-muted hover:border-navy-100 hover:text-navy-900"
                  }`}
                >
                  {formatWeek(option)}
                </Link>
              ))}
            </div>
          )}
        </div>

        {unscoped && (
          <Card className="mb-6">
            <div className="px-6 py-4">
              <p className="text-sm font-medium text-navy-900">Account not linked to employee data</p>
              <p className="mt-1 text-sm text-muted">
                An administrator needs to link this account to an employee ID before your team&apos;s
                data will appear.
              </p>
            </div>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={user.role === "agent" ? "Me" : "Employees"} value={summary.totalEmployees} />
          <StatCard label="Passing this week" value={summary.passing} tone="pass" />
          <StatCard label="At risk" value={summary.atRisk} tone="warn" />
          <StatCard label="Failing" value={summary.failing} tone="fail" />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Active action items" value={summary.openIssues} href="/action-items" />
          <StatCard
            label="Awaiting acknowledgement"
            value={summary.awaitingAcknowledgement}
            tone="warn"
            href="/action-items"
          />
          <StatCard label="Monitoring" value={summary.monitoring} />
          <StatCard label="Sustained" value={summary.sustained} tone="pass" />
          <StatCard
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? "fail" : "default"}
            hint={overdue > 0 ? "Past the action plan due date" : undefined}
            href="/action-items"
          />
        </div>

        {showsRollup && rollup.length > 0 && (
          <Card className="mt-6">
            <CardHeader
              title="By supervisor"
              subtitle="Where the open work sits across your organization"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-cream text-left">
                    <th className="px-6 py-2.5 font-semibold text-navy-800">Supervisor</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Team</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">
                      Failing this week
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">
                      Open items
                    </th>
                    <th className="px-6 py-2.5 text-right font-semibold text-navy-800">
                      Awaiting ack
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((row) => (
                    <tr
                      key={row.supervisorName}
                      className="border-b border-line/70 last:border-0 hover:bg-cream/60"
                    >
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees?supervisor=${encodeURIComponent(row.supervisorName)}${
                            week ? `&week=${week}` : ""
                          }`}
                          className="font-medium text-navy-900 underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.supervisorName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                        {row.teamSize}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          row.failingThisWeek > 0 ? "text-fail" : "text-muted"
                        }`}
                      >
                        {row.failingThisWeek || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-navy-900">
                        {row.openIssues || "—"}
                      </td>
                      <td
                        className={`px-6 py-2 text-right font-mono tabular-nums ${
                          row.awaitingAcknowledgement > 0 ? "text-warn" : "text-muted"
                        }`}
                      >
                        {row.awaitingAcknowledgement || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="mt-6">
          <CardHeader
            title="Attention required"
            subtitle={
              week
                ? "Metrics that failed their threshold this week"
                : "Import performance data to populate this view"
            }
            action={
              <Link
                href="/action-items"
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy-800 transition hover:border-orange-brand hover:text-orange-brand"
              >
                All action items
              </Link>
            }
          />

          {attention.length === 0 ? (
            <EmptyState
              title="Nothing failing this week"
              description="Every tracked metric met its threshold for the selected week."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-cream text-left">
                    <th className="px-6 py-2.5 font-semibold text-navy-800">Employee</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">KPI</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Result</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Target</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Sample</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Action item</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Status</th>
                    <th className="px-6 py-2.5 text-right font-semibold text-navy-800">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((row) => (
                    <tr
                      key={`${row.employeeId}-${row.kpiCode}`}
                      className="border-b border-line/70 last:border-0 hover:bg-cream/60"
                    >
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees/${row.employeeId}${week ? `?week=${week}` : ""}`}
                          className="font-medium text-navy-900 underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">{row.employeeEid}</span>
                      </td>
                      <td className="px-3 py-2 text-navy-800">{row.kpiName}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-fail">
                        {formatMetric(row.actualValue, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                        {formatMetric(row.targetValue, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {row.sampleSize === null ? (
                          <span className="text-muted">—</span>
                        ) : row.sampleSize <= 2 ? (
                          <span
                            className="rounded bg-warn-bg px-1.5 py-0.5 text-warn"
                            title="Very few source rows behind this figure — read with caution"
                          >
                            {row.sampleSize}
                          </span>
                        ) : (
                          <span className="text-muted">{row.sampleSize}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {row.actionItemCode ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.issueStatus ? <StatusBadge status={row.issueStatus} /> : "—"}
                      </td>
                      <td className="px-6 py-2 text-right">
                        <Link
                          href={`/employees/${row.employeeId}${week ? `?week=${week}` : ""}`}
                          className="text-sm font-medium text-orange-brand underline-offset-4 hover:underline"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
