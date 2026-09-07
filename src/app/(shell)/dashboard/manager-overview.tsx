import { Card, CardHeader, STATUS_LABELS } from "@/components/ui";
import { getAnalytics, getMboOverview, type AnalyticsFilters } from "@/lib/queries/analytics";
import type { Period } from "@/lib/queries/period";
import type { SupervisorRollup } from "@/lib/queries/roster";
import { getOrgTrend } from "@/lib/queries/team-trend";
import { MboTree } from "./mbo-tree";
import type { ShellActionItems } from "./dashboard-shell";
import { ManagerDashboard, type SupervisorRow } from "./manager-dashboard";

/**
 * A manager's org-wide overview, cut by supervisor.
 *
 * The supervisors are the rows because they are the level a manager actually
 * manages — and because the three chart frames this replaced (fail rate by
 * supervisor, MBO pass rate by supervisor, action items by status) were three
 * ways of saying what one table of supervisors says at once.
 *
 * Server half: everything below the fold is fetched here, and the interactive
 * frame is handed to ManagerDashboard.
 */
export async function ManagerOverview({
  managerName,
  period,
  weeks,
  rollup,
  actionItems,
}: {
  managerName: string;
  /** The reporting period selected above; the overview must follow it. */
  period: Period | null;
  /** Reporting weeks, newest first; the trend takes the most recent twelve. */
  weeks: string[];
  rollup: SupervisorRollup[];
  actionItems: ShellActionItems;
}) {
  // Weeks are keyed by their start date, so a month bounds the weeks whose
  // start falls inside it. Without these the overview would silently report
  // every week ever imported while the picker above said otherwise.
  const filters: AnalyticsFilters = {
    manager: managerName,
    weekFrom: period?.start,
    weekTo: period?.end,
  };

  const [analytics, mbo] = await Promise.all([getAnalytics(filters), getMboOverview(filters)]);

  // The tree is already the manager's span as it stood at the end of the
  // period, resolved through the dated assignments — so flattening it costs
  // nothing and cannot disagree with the attainment figures below.
  const roster: Array<{ employeeId: string; supervisorName: string | null }> = [];
  const bySupervisor = new Map<
    string,
    { site: string | null; headcount: number; passing: number; scored: number }
  >();
  for (const site of mbo.sites) {
    for (const manager of site.children) {
      for (const supervisor of manager.children) {
        // A supervisor with people at two sites appears under each one, so
        // the halves are merged rather than shown as two unrelated teams.
        const entry = bySupervisor.get(supervisor.label) ?? {
          site: site.label,
          headcount: 0,
          passing: 0,
          scored: 0,
        };
        entry.headcount += supervisor.headcount;
        entry.passing += supervisor.passing;
        entry.scored += supervisor.scored;
        bySupervisor.set(supervisor.label, entry);
        for (const leaf of supervisor.children) {
          if (leaf.employeeId) {
            roster.push({ employeeId: leaf.employeeId, supervisorName: supervisor.label });
          }
        }
      }
    }
  }

  const trend = await getOrgTrend(roster, weeks.slice(0, 12));

  const rollupByName = new Map(rollup.map((r) => [r.supervisorName, r]));
  // Failing comes from the analytics breakdown rather than the rollup: the
  // rollup counts the newest week that exists anywhere, while the summary
  // above counts the newest week inside the selected range. Those are
  // different weeks whenever the range is not the newest one, and taking one
  // from each put "0 failing" on every row beside a summary saying 15.
  const failingByName = new Map(analytics.bySupervisor.map((g) => [g.label, g]));
  const supervisors: SupervisorRow[] = [...bySupervisor.entries()]
    .map(([name, totals]) => {
      // Open and awaiting are a work queue, not a period measure, so they
      // stay current — matching the action-item block in the summary.
      const counts = rollupByName.get(name);
      const evaluated = failingByName.get(name);
      return {
        name,
        site: totals.site,
        // The rollup counts who they manage now; the tree counts whose
        // results are in this period. They differ after a realignment, and
        // the roster the numbers came from is the honest one.
        teamSize: totals.headcount,
        failing: evaluated?.failing ?? 0,
        evaluated: evaluated?.employees ?? 0,
        openIssues: counts?.openIssues ?? 0,
        awaiting: counts?.awaitingAcknowledgement ?? 0,
        mboPassRate: totals.scored > 0 ? (totals.passing / totals.scored) * 100 : null,
        mboPassing: totals.passing,
        mboScored: totals.scored,
      };
    })
    // Most open work first, matching how getSupervisorRollup already orders.
    .sort((a, b) => b.openIssues - a.openIssues || a.name.localeCompare(b.name));

  if (analytics.totalEmployees === 0) {
    return (
      <Card className="mb-6">
        <CardHeader title="Organization overview" subtitle="No employees are linked to your span" />
        <p className="px-6 py-8 text-center text-sm text-muted">
          Your account is not linked to a manager name in the imported data, so there is nothing to
          summarise. An administrator can set that link on the Users page.
        </p>
      </Card>
    );
  }

  const worstKpi = [...analytics.kpis].sort((a, b) => b.failRate - a.failRate)[0] ?? null;

  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
          Organization overview
        </h2>
        <p className="mt-1 text-sm text-muted">
          {supervisors.length} supervisor{supervisors.length === 1 ? "" : "s"} ·{" "}
          {analytics.totalEmployees} agent{analytics.totalEmployees === 1 ? "" : "s"}
          {period ? ` · ${period.label}` : ""}
        </p>
      </div>

      <ManagerDashboard
        stats={{
          failing: analytics.failingEmployees,
          total: analytics.totalEmployees,
          withData: analytics.employeesWithData,
          asOfLabel: analytics.asOfLabel,
          mboPassRate: mbo.passRate,
          mboPassing: mbo.passing,
          mboScored: mbo.scored,
          worstKpi,
        }}
        supervisors={supervisors}
        asOfLabel={analytics.asOfLabel}
        trend={trend}
        kpis={[...analytics.kpis].sort((a, b) => b.failRate - a.failRate)}
        topAgents={mbo.topAgents.slice(0, 6)}
        actionItems={actionItems}
        statuses={analytics.statuses.map((s) => ({
          ...s,
          label: STATUS_LABELS[s.status] ?? s.status,
        }))}
        periodLabel={period?.label ?? "All weeks"}
        mboTree={<MboTree sites={mbo.sites} />}
      />
    </section>
  );
}
