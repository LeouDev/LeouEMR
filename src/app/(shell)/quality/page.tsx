import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui";
import { STANDING_LABELS, auditWeekOf, isAuditWeekStart, shiftWeek, weekLabel } from "@/lib/quality/week";
import { getQaRoster } from "@/lib/queries/quality";
import { requireQualityUser, todayIso } from "./access";
import { QualityBand, QualityTabs, Tag } from "./quality-tabs";

/**
 * The weekly requirement: who on the roster owes audits this week, how
 * many are done, and a button to start the next one.
 */
export default async function QualityDashboardPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireQualityUser();
  const params = await searchParams;
  const thisWeek = auditWeekOf(todayIso());
  const week = isAuditWeekStart(params.week) ? auditWeekOf(params.week) : thisWeek;
  const roster = await getQaRoster(user, week);

  const isThisWeek = week.start === thisWeek.start;
  const showLeader = user.role !== "supervisor";

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="dashboard" />

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active agents" value={roster.activeAgents} hint={isThisWeek ? "This week" : `Week of ${weekLabel(week)}`} />
          <StatCard label="Required audits" value={roster.required} hint="2 per active agent" />
          <StatCard label="Completed" value={roster.completed} tone="pass" />
          <StatCard
            label="Completion"
            value={`${roster.completionPct}%`}
            tone={roster.required === 0 ? "default" : roster.completionPct >= 100 ? "pass" : "warn"}
            hint={roster.required > 0 && roster.completed < roster.required ? `${roster.required - roster.completed} to go` : undefined}
          />
        </div>

        <Card>
          <CardHeader
            title={isThisWeek ? "This week's roster" : "Roster"}
            subtitle={`Week of ${weekLabel(week)} · Sunday to Saturday`}
            action={
              <div className="flex border-2 border-ink">
                <NavLink href={`/quality?week=${shiftWeek(week, -1).start}`} prefetch={false} className="px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  ← Previous
                </NavLink>
                <NavLink href="/quality" prefetch={false} className={`border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${isThisWeek ? "bg-ink text-white" : "hover:bg-orange-brand-100"}`}>
                  This week
                </NavLink>
                <NavLink href={`/quality?week=${shiftWeek(week, 1).start}`} prefetch={false} className="border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  Next →
                </NavLink>
              </div>
            }
          />

          {roster.rows.length === 0 ? (
            <EmptyState
              title="No one on your roster"
              description="Agents appear here once the roster places them under you. An administrator links accounts on the Users page."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Agent</th>
                    {showLeader && <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Team leader</th>}
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Required</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Completed</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Progress</th>
                    <th className="px-6 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {roster.rows.map((row) => {
                    const active = row.standing === "active";
                    const pct = row.required === 0 ? 0 : Math.min(100, Math.round((row.completed / row.required) * 100));
                    return (
                      <tr key={row.id} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                        <td className="px-6 py-2">
                          <Link href={`/employees/${row.id}`} prefetch={false} className="font-semibold text-ink underline-offset-4 hover:text-orange-brand hover:underline">
                            {row.name}
                          </Link>
                        </td>
                        {showLeader && <td className="px-3 py-2 text-xs text-muted">{row.supervisorName ?? "—"}</td>}
                        <td className="px-3 py-2">
                          <Tag tone={active ? "ink" : "muted"}>{STANDING_LABELS[row.standing]}</Tag>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{active ? row.required : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink">
                          {active || row.completed > 0 ? row.completed : "—"}
                        </td>
                        <td className="min-w-36 px-3 py-2">
                          {active ? (
                            <div className="h-2 border border-ink bg-line" aria-label={`${pct}% of required audits done`}>
                              <div className={`h-full ${pct >= 100 ? "bg-pass" : "bg-orange-brand"}`} style={{ width: `${pct}%` }} />
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Not required</span>
                          )}
                        </td>
                        <td className="px-6 py-2 text-right">
                          {active && (
                            <NavLink href={`/quality/new?agent=${row.id}`} prefetch={false} className="btn-secondary inline-block px-3 py-1.5 text-xs">
                              Audit
                            </NavLink>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
