import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, formatWeek } from "@/components/ui";
import { EwsRiskBadge } from "@/app/employees/[employeeId]/ews-panel";
import { getCurrentUser } from "@/lib/auth/session";
import { getAvailableWeeks, getLatestWeek } from "@/lib/queries/performance";
import { getRoster, getRosterFacets } from "@/lib/queries/roster";
import { RosterFilters } from "./roster-filters";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    supervisor?: string;
    site?: string;
    risk?: string;
    standing?: string;
    week?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const weeks = await getAvailableWeeks();
  const latest = await getLatestWeek();
  const week = params.week && weeks.includes(params.week) ? params.week : latest;

  const [rows, facets] = await Promise.all([
    getRoster(
      user,
      week,
      {
        search: params.q,
        supervisor: params.supervisor,
        site: params.site,
        risk: params.risk,
        standing: params.standing,
      },
      300,
    ),
    getRosterFacets(user),
  ]);

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/employees" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">Employees</h1>
          <p className="mt-1 text-sm text-muted">
            {week ? `Standing for the week of ${formatWeek(week)}` : "No performance data yet"}
          </p>
        </div>

        <RosterFilters
          supervisors={facets.supervisors}
          sites={facets.sites}
          initial={{
            q: params.q ?? "",
            supervisor: params.supervisor ?? "",
            site: params.site ?? "",
            risk: params.risk ?? "",
            standing: params.standing ?? "",
          }}
        />

        <Card className="mt-4">
          <CardHeader
            title="Roster"
            subtitle={`${rows.length} employee${rows.length === 1 ? "" : "s"}`}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="No matches"
              description="Nothing in your scope matches these filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-cream text-left">
                    <th className="px-6 py-2.5 font-semibold text-navy-800">Employee</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Supervisor</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Site</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">
                      Failing KPIs
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold text-navy-800">
                      Open items
                    </th>
                    <th className="px-6 py-2.5 font-semibold text-navy-800">EWS risk</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0 hover:bg-cream/60">
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees/${row.id}${week ? `?week=${week}` : ""}`}
                          className="font-medium text-navy-900 underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
                      </td>
                      <td className="px-3 py-2 text-navy-800">{row.supervisorName ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{row.site ?? "—"}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          row.failingKpis > 0 ? "text-fail" : "text-muted"
                        }`}
                      >
                        {row.failingKpis || "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          row.openIssues > 0 ? "text-navy-900" : "text-muted"
                        }`}
                      >
                        {row.openIssues || "—"}
                      </td>
                      <td className="px-6 py-2">
                        {row.ewsRisk ? (
                          <EwsRiskBadge riskLevel={row.ewsRisk} score={row.ewsScore ?? undefined} />
                        ) : (
                          <span className="text-xs text-muted">Not assessed</span>
                        )}
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
