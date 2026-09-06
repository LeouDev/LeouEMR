import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  Card,
  CardHeader,
  EmptyState,
  StatusBadge,
  formatMetric,
  formatWeek,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getAvailableWeeks, getEmployeeWeek, getLatestWeek } from "@/lib/queries/performance";
import { OPEN_STATUSES } from "@/lib/queries/performance";

function TrendArrow({
  current,
  prior,
  lowerIsBetter,
}: {
  current: number;
  prior?: number;
  lowerIsBetter: boolean;
}) {
  if (prior === undefined) return <span className="text-muted">—</span>;

  const delta = current - prior;
  if (Math.abs(delta) < 1e-9) return <span className="text-muted">→</span>;

  const improving = lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <span className={improving ? "text-pass" : "text-fail"} title={`Previous: ${prior.toFixed(2)}`}>
      {delta > 0 ? "↑" : "↓"}
    </span>
  );
}

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
  const weeks = await getAvailableWeeks();
  const latest = await getLatestWeek();
  const week = query.week && weeks.includes(query.week) ? query.week : latest;

  const data = await getEmployeeWeek(user, employeeId, week);
  if (!data) notFound();

  const { employee, metrics, priorByKpi, actionItems } = data;
  const openItems = actionItems.filter((item) => OPEN_STATUSES.includes(item.status as never));
  const failing = metrics.filter((m) => m.status === "fail").length;

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/dashboard" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link
          href={`/dashboard${week ? `?week=${week}` : ""}`}
          className="text-sm font-medium text-muted underline-offset-4 hover:text-navy-900 hover:underline"
        >
          ← Back to dashboard
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
          <div className="flex flex-wrap gap-1.5">
            {weeks.slice(0, 6).map((option) => (
              <Link
                key={option}
                href={`/employees/${employeeId}?week=${option}`}
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
        </div>

        <Card>
          <CardHeader
            title="Performance summary"
            subtitle={week ? `Week of ${formatWeek(week)}` : "No week selected"}
            action={
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  failing > 0 ? "bg-fail-bg text-fail" : "bg-pass-bg text-pass"
                }`}
              >
                {failing > 0 ? `${failing} failing` : "All metrics passing"}
              </span>
            }
          />

          {metrics.length === 0 ? (
            <EmptyState
              title="No metrics for this week"
              description="This employee has no imported results for the selected week."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-cream text-left">
                    <th className="px-6 py-2.5 font-semibold text-navy-800">KPI</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Result</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">Target</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Status</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-navy-800">Trend</th>
                    <th className="px-6 py-2.5 text-right font-semibold text-navy-800">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric) => (
                    <tr key={metric.kpiCode} className="border-b border-line/70 last:border-0">
                      <td className="px-6 py-2 font-medium text-navy-900">{metric.kpiName}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          metric.status === "fail" ? "text-fail" : "text-navy-900"
                        }`}
                      >
                        {formatMetric(metric.actualValue, metric.kpiCode)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                        {formatMetric(metric.targetValue, metric.kpiCode)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={metric.status} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TrendArrow
                          current={metric.actualValue}
                          prior={priorByKpi.get(metric.kpiCode)}
                          lowerIsBetter={metric.direction === "lower_is_better"}
                        />
                      </td>
                      <td className="px-6 py-2 text-right font-mono text-xs text-muted tabular-nums">
                        {metric.sampleSize ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="mt-6">
          <CardHeader
            title="Development plan"
            subtitle={`${openItems.length} active item${openItems.length === 1 ? "" : "s"}`}
          />

          {actionItems.length === 0 ? (
            <EmptyState
              title="No action items"
              description="Nothing has failed a threshold for this employee, so no development items exist."
            />
          ) : (
            <ul className="divide-y divide-line">
              {actionItems.map((item) => (
                <li key={item.actionItemId} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-navy-900">{item.kpiName}</span>
                        <StatusBadge status={item.status} />
                        <span className="font-mono text-xs text-muted">{item.actionItemCode}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        Opened week of {formatWeek(item.openedWeek)} ·{" "}
                        <span className="font-medium text-navy-800">
                          {item.consecutivePassingWeeks} / 4
                        </span>{" "}
                        consecutive passing weeks
                        {!item.hasRca && " · RCA not yet entered"}
                      </p>
                    </div>
                    <Link
                      href={`/action-items/${item.actionItemId}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy-800 transition hover:border-orange-brand hover:text-orange-brand"
                    >
                      Open
                    </Link>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-dark">
                    <div
                      className="h-full rounded-full bg-orange-brand transition-all"
                      style={{ width: `${Math.min(100, (item.consecutivePassingWeeks / 4) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
