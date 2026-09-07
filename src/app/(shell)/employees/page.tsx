import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, EwsRiskBadge, PageBand, StatusBadge, formatWeek } from "@/components/ui";

import { getCurrentUser } from "@/lib/auth/session";
import { getActionItems, getAvailableWeeks, getLatestWeek } from "@/lib/queries/performance";
import { getRoster, getRosterFacets } from "@/lib/queries/roster";
import { RosterFilters } from "./roster-filters";

/** Statuses an item sits in before anyone has written an RCA/action plan — see submitRcaAndPlan in the engine. */
const UNSTARTED_STATUSES = new Set(["OPEN", "REOPENED"]);

const ATTENTION_SHOWN = 5;

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

  const [{ rows, total }, facets, openItems] = await Promise.all([
    getRoster(user, week, {
      search: params.q,
      supervisor: params.supervisor,
      site: params.site,
      risk: params.risk,
      standing: params.standing,
    }),
    getRosterFacets(user),
    getActionItems(user, { openOnly: true }),
  ]);

  // Items nobody has written an RCA/plan for yet — the cases actually
  // blocked on this manager, not ones already progressing through
  // acknowledgement or monitoring. Oldest first, since that's the one
  // that's been waiting longest for a response.
  const needsAttention = openItems
    .filter((item) => UNSTARTED_STATUSES.has(item.status))
    .sort((a, b) => a.openedWeek.localeCompare(b.openedWeek));

  return (
    <>
      <PageBand title="Employees" subtitle="Roster and weekly standing" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <p className="text-sm text-muted">
            {week ? `Standing for the week of ${formatWeek(week)}` : "No performance data yet"}
          </p>
        </div>

        {needsAttention.length > 0 && (
          <Card className="mb-6 border-fail/40">
            <CardHeader
              title="Needs your attention"
              subtitle={`${needsAttention.length} open item${needsAttention.length === 1 ? "" : "s"} with no root cause analysis yet`}
              action={
                needsAttention.length > ATTENTION_SHOWN ? (
                  <Link
                    href="/action-items"
                    className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
                  >
                    View all {needsAttention.length}
                  </Link>
                ) : undefined
              }
            />
            <ul className="divide-y-2 divide-line">
              {needsAttention.slice(0, ATTENTION_SHOWN).map((item) => (
                <li key={item.actionItemId}>
                  <Link
                    href={`/action-items/${item.actionItemId}`}
                    prefetch={false}
                    className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 transition hover:bg-orange-brand-100"
                  >
                    <span>
                      <span className="font-medium text-ink">{item.employeeName}</span>
                      <span className="ml-2 text-sm text-muted">{item.kpiName}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted">Opened week of {formatWeek(item.openedWeek)}</span>
                      <StatusBadge status={item.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

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
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {row.openIssues > 0 ? (
                          <Link
                            href={`/action-items?employee=${row.id}`}
                            prefetch={false}
                            className="text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                          >
                            {row.openIssues}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
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
    </>
  );
}
