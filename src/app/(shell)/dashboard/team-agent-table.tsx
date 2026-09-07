import type { TeamPeriodComparison } from "@/lib/queries/my-stats";
import { orderIndex } from "./kpi-groups";
import { TeamAgentRows, type AgentRow } from "./team-agent-rows";

/**
 * Hidden for the same reason they left the org-wide comparison: DPU and DPO
 * are MBO gates rather than standalone results, sit at 100.00 for nearly
 * everyone, and cost two columns of a table that already scrolls sideways.
 * They still count toward MBO, and the MBO page still names the missed gate.
 */
const HIDDEN = new Set(["DPU", "DPO"]);

/**
 * The team, one row per agent, worst first.
 *
 * Replaces the generic comparison matrix for a supervisor: the same figures,
 * but led by how many KPIs each person is below rather than by KPI, because a
 * supervisor works down people and not columns.
 *
 * Sorting and shaping happen here, on the server; only the show-all toggle is
 * client-side. Seeing the rest of your own team is a change of view, not a
 * different question, so it should not cost a navigation — "All agents" used
 * to hand a supervisor the Employees roster, which answers something else and
 * loses the comparison they were reading.
 */
export function TeamAgentTable({
  data,
  openByEmployee,
}: {
  data: TeamPeriodComparison;
  /** Open action items per employee id. */
  openByEmployee: Map<string, number>;
}) {
  const kpis = data.kpis
    .filter((k) => !HIDDEN.has(k.code))
    .sort((a, b) => orderIndex(a.code) - orderIndex(b.code))
    .map((k) => ({ code: k.code, name: k.name }));

  if (kpis.length === 0 || data.rows.length === 0) return null;

  // The count shown is the count of what is on screen: counting a hidden
  // gate would sort someone to the top for a reason the row cannot show.
  const rows: AgentRow[] = data.rows
    .map((row) => ({
      employeeId: row.employeeId,
      name: row.name,
      eid: row.eid,
      cells: row.cells,
      below: kpis.filter((k) => row.cells[k.code]?.status === "FAIL").length,
      // Flattened out of the Map here so only plain data crosses the boundary.
      open: openByEmployee.get(row.employeeId) ?? 0,
    }))
    .sort((a, b) => b.below - a.below || a.name.localeCompare(b.name));

  return (
    <div className="mt-7 border-t-2 border-ink pt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h6 className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
          {data.period.label} by agent
        </h6>
        <span className="text-xs text-muted">
          Change from {data.previous.label} · sorted by KPIs below target
        </span>
      </div>

      <TeamAgentRows kpis={kpis} rows={rows} />
    </div>
  );
}
