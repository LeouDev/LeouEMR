import { NavLink } from "@/components/nav-link";
import { Card, CardHeader, StatCard } from "@/components/ui";
import { canFileAudit } from "@/lib/auth/scope";
import { auditWeeksOfMonth, completionGrid, monthLabel, monthStartOf, shiftMonth } from "@/lib/quality/completion";
import { AUDITS_PER_AGENT } from "@/lib/quality/week";
import { getQaRosters } from "@/lib/queries/quality";
import { requireQualityUser, todayIso } from "../access";
import { QualityBand, QualityTabs, Tag } from "../quality-tabs";
import { CompletionChart } from "./completion-chart";

/**
 * Audit completion per team leader, week by week across a month: the
 * requirement rolled up by team for each of the month's four or five audit
 * weeks, as grouped columns against the 100% line, with the counts in a
 * table under it. The same roster read as the dashboard, so the two agree.
 */
export default async function AuditCompletionPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireQualityUser();
  const params = await searchParams;
  const today = todayIso();
  const month = monthStartOf(params.month, today);
  const weeks = auditWeeksOfMonth(month);
  const rosters = await getQaRosters(user, weeks);
  const leaders = completionGrid(weeks, rosters.map((r) => r.rows));

  const isThisMonth = month === `${today.slice(0, 7)}-01`;
  const required = leaders.reduce((sum, l) => sum + l.required, 0);
  const completed = leaders.reduce((sum, l) => sum + l.completed, 0);
  const overallPct = required === 0 ? null : Math.round((completed / required) * 100);
  const met = leaders.filter((l) => l.completionPct !== null && l.completionPct >= 100).length;
  const monthParam = (start: string) => start.slice(0, 7);

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="completion" canFile={canFileAudit(user)} perLeader={user.role !== "supervisor"} />

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Team leaders" value={leaders.length} hint={`With audits owed in ${monthLabel(month)}`} />
          <StatCard label="At 100% for the month" value={met} tone={leaders.length > 0 && met === leaders.length ? "pass" : "default"} hint="Every required audit filed" />
          <StatCard
            label="Month completion"
            value={overallPct === null ? "—" : `${overallPct}%`}
            tone={overallPct === null ? "default" : overallPct >= 100 ? "pass" : "warn"}
            hint={`${completed} of ${required} · ${AUDITS_PER_AGENT} per active agent per week`}
          />
        </div>

        <Card>
          <CardHeader
            title="Audit completion per team leader"
            subtitle={`${monthLabel(month)} · one bar per audit week (Sunday to Saturday) · share of required audits filed`}
            action={
              <div className="flex border-2 border-ink">
                <NavLink href={`/quality/completion?month=${monthParam(shiftMonth(month, -1))}`} prefetch={false} className="px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  ← Previous
                </NavLink>
                <NavLink href="/quality/completion" prefetch={false} className={`border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${isThisMonth ? "bg-ink text-white" : "hover:bg-orange-brand-100"}`}>
                  This month
                </NavLink>
                <NavLink href={`/quality/completion?month=${monthParam(shiftMonth(month, 1))}`} prefetch={false} className="border-l-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-orange-brand-100">
                  Next →
                </NavLink>
              </div>
            }
          />

          <div className="px-6 pt-4 pb-2">
            <CompletionChart rows={leaders} weeks={weeks} />
          </div>

          {leaders.length > 0 && (
            <div className="overflow-x-auto border-t-2 border-line">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Team leader</th>
                    {weeks.map((week, i) => (
                      <th key={week.start} className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                        W{i + 1}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">Month</th>
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row) => (
                    <tr key={row.leader} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                      <td className="px-6 py-2 font-semibold text-ink">{row.leader}</td>
                      {row.cells.map((cell, i) => (
                        <td key={i} className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink">
                          {cell.completionPct === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <>
                              {cell.completed}/{cell.required}
                              <span className={`ml-1.5 ${cell.completionPct >= 100 ? "text-pass" : "text-muted"}`}>{cell.completionPct}%</span>
                            </>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink">
                        {row.completed}/{row.required}
                        <span className="ml-1.5 text-muted">{row.completionPct === null ? "—" : `${row.completionPct}%`}</span>
                      </td>
                      <td className="px-6 py-2">
                        <Tag tone={row.completionPct !== null && row.completionPct >= 100 ? "pass" : row.completed === 0 ? "fail" : "warn"}>
                          {row.completionPct !== null && row.completionPct >= 100
                            ? "Met"
                            : row.completed === 0
                              ? "Not started"
                              : `${Math.max(0, row.required - row.completed)} to go`}
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
