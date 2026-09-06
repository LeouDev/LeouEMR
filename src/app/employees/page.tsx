import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, EwsRiskBadge, PageBand, formatWeek } from "@/components/ui";

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

  const [{ rows, total }, facets] = await Promise.all([
    getRoster(user, week, {
      search: params.q,
      supervisor: params.supervisor,
      site: params.site,
      risk: params.risk,
      standing: params.standing,
    }),
    getRosterFacets(user),
  ]);

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/employees" />
      <PageBand title="Employees" subtitle="Roster and weekly standing" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <p className="text-sm text-muted">
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
            subtitle={
              rows.length < total
                ? `Showing the first ${rows.length} of ${total} — search or filter to narrow further`
                : `${rows.length} employee${rows.length === 1 ? "" : "s"}`
            }
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
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Supervisor</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Site</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">
                      Failing KPIs
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-ink">
                      Open items
                    </th>
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">EWS risk</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                      <td className="px-6 py-2">
                        <Link
                          href={`/employees/${row.id}${week ? `?week=${week}` : ""}`}
                          prefetch={false}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
                      </td>
                      <td className="px-3 py-2 text-ink">{row.supervisorName ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{row.site ?? "—"}</td>
                      <td
                        className={`px-3 py-2 font-mono tabular-nums ${row.failingKpis > 0 ?"text-fail" : "text-muted"
                        }`}
                      >
                        {row.failingKpis || "—"}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono tabular-nums ${row.openIssues > 0 ?"text-ink" : "text-muted"
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
