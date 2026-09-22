import { NavLink } from "@/components/nav-link";
import { Card, CardHeader, StatCard } from "@/components/ui";
import { canFileAudit } from "@/lib/auth/scope";
import { completionByLeader } from "@/lib/quality/completion";
import { AUDITS_PER_AGENT, auditWeekOf, isAuditWeekStart, shiftWeek, weekLabel } from "@/lib/quality/week";
import { getQaRoster } from "@/lib/queries/quality";
import { requireQualityUser, todayIso } from "../access";
import { QualityBand, QualityTabs, Tag } from "../quality-tabs";
import { CompletionChart } from "./completion-chart";

/**
 * Audit completion per team leader: the week's requirement rolled up by
 * team, as columns against the 100% line, with the counts in a table under
 * it. The same roster the dashboard reads, so the two always agree, and the
 * same week control.
 */
export default async function AuditCompletionPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireQualityUser();
  const params = await searchParams;
  const thisWeek = auditWeekOf(todayIso());
  const week = isAuditWeekStart(params.week) ? auditWeekOf(params.week) : thisWeek;
  const roster = await getQaRoster(user, week);
  const leaders = completionByLeader(roster.rows);

  const isThisWeek = week.start === thisWeek.start;
  const met = leaders.filter((l) => l.completionPct >= 100).length;

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="completion" canFile={canFileAudit(user)} perLeader={user.role !== "supervisor"} />

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Team leaders" value={leaders.length} hint={isThisWeek ? "With audits owed this week" : `Week of ${weekLabel(week)}`} />
          <StatCard label="At 100%" value={met} tone={leaders.length > 0 && met === leaders.length ? "pass" : "default"} hint="Every required audit filed" />
          <StatCard
            label="Overall completion"
            value={`${roster.completionPct}%`}
            tone={roster.required === 0 ? "default" : roster.completionPct >= 100 ? "pass" : "warn"}
            hint={`${roster.completed} of ${roster.required} · ${AUDITS_PER_AGENT} per active agent`}
          />
        </div>

        <Card>
          <CardHeader
            title="Audit completion per team leader"
            subtitle={`Week of ${weekLabel(week)} · Sunday to Saturday · share of required audits filed`}
            action={
              <div className="flex border-2 border-ink">
                <NavLink href={`/quality/completion?week=${shiftWeek(week, -1).start}`} prefetch={false} className="px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  ← Previous
                </NavLink>
                <NavLink href="/quality/completion" prefetch={false} className={`border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${isThisWeek ? "bg-ink text-white" : "hover:bg-orange-brand-100"}`}>
                  This week
                </NavLink>
                <NavLink href={`/quality/completion?week=${shiftWeek(week, 1).start}`} prefetch={false} className="border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  Next →
                </NavLink>
              </div>
            }
          />

          <div className="px-6 pt-4 pb-2">
            <CompletionChart rows={leaders} />
          </div>

          {leaders.length > 0 && (
            <div className="overflow-x-auto border-t-2 border-line">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Team leader</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Active agents</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Required</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Completed</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Completion</th>
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row) => (
                    <tr key={row.leader} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                      <td className="px-6 py-2 font-semibold text-ink">{row.leader}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{row.activeAgents}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">{row.required}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink">{row.completed}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink">{row.completionPct}%</td>
                      <td className="px-6 py-2">
                        <Tag tone={row.completionPct >= 100 ? "pass" : row.completed === 0 ? "fail" : "warn"}>
                          {row.completionPct >= 100 ? "Met" : row.completed === 0 ? "Not started" : `${row.required - row.completed} to go`}
                        </Tag>
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
