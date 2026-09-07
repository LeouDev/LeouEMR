import Link from "next/link";
import { formatMetric, metricTone } from "@/components/ui";
import type { TeamKpiCell, TeamPeriodComparison } from "@/lib/queries/my-stats";
import { KPI_ORDER } from "./agent-performance";

const SHOWN = 6;

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
    .sort(
      (a, b) =>
        (KPI_ORDER.indexOf(a.code) < 0 ? 99 : KPI_ORDER.indexOf(a.code)) -
        (KPI_ORDER.indexOf(b.code) < 0 ? 99 : KPI_ORDER.indexOf(b.code)),
    );

  if (kpis.length === 0 || data.rows.length === 0) return null;

  // The count shown is the count of what is on screen: counting a hidden
  // gate would sort someone to the top for a reason the row cannot show.
  const rows = data.rows
    .map((row) => ({
      ...row,
      below: kpis.filter((k) => row.cells[k.code]?.status === "FAIL").length,
    }))
    .sort((a, b) => b.below - a.below || a.name.localeCompare(b.name));

  const shown = rows.slice(0, SHOWN);

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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="px-2 py-2 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Agent
              </th>
              <th className="px-2 py-2 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Below
              </th>
              {kpis.map((kpi) => (
                <th
                  key={kpi.code}
                  className="px-2 py-2 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase"
                >
                  {kpi.name}
                </th>
              ))}
              <th className="px-2 py-2 text-right text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.employeeId}
                className={`border-b border-line last:border-0 ${
                  row.below >= 4 ? "bg-fail-bg" : "hover:bg-cream"
                }`}
              >
                <td className="px-2 py-2.5">
                  <Link
                    href={`/employees/${row.employeeId}`}
                    prefetch={false}
                    className="font-semibold text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="ml-1.5 font-mono text-[11px] text-muted">{row.eid}</span>
                </td>
                <td
                  className={`px-2 py-2.5 text-right font-mono font-extrabold tabular-nums ${
                    row.below > 0 ? "text-fail" : "text-muted"
                  }`}
                >
                  {row.below || "—"}
                </td>
                {kpis.map((kpi) => (
                  <td key={kpi.code} className="px-2 py-2.5 text-right leading-tight">
                    <Cell cell={row.cells[kpi.code]} kpiCode={kpi.code} />
                  </td>
                ))}
                <td className="px-2 py-2.5 text-right font-mono text-muted tabular-nums">
                  {openByEmployee.get(row.employeeId) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > SHOWN && (
        <p className="mt-2 text-xs text-muted">
          Showing {shown.length} of {rows.length} ·{" "}
          <Link href="/employees" className="text-ink underline-offset-4 hover:text-orange-brand hover:underline">
            All agents
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * One KPI for one agent, this period over the change from last.
 *
 * The arrow follows the sign and the colour follows improvement, so a falling
 * handle time reads as the good result it is.
 */
function Cell({ cell, kpiCode }: { cell: TeamKpiCell | undefined; kpiCode: string }) {
  if (!cell) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-col">
      <span className={`font-mono font-semibold tabular-nums ${metricTone(cell.status)}`}>
        {formatMetric(cell.current, kpiCode)}
      </span>
      {cell.delta !== null && Math.abs(cell.delta) >= 0.005 ? (
        <span
          className={`font-mono text-[10px] tabular-nums ${
            cell.improved === false ? "text-fail" : "text-muted"
          }`}
        >
          {cell.delta > 0 ? "▲" : "▼"} {formatMetric(Math.abs(cell.delta), kpiCode)}
        </span>
      ) : (
        <span className="font-mono text-[10px] text-muted tabular-nums">
          {cell.previous === null ? "new" : "no change"}
        </span>
      )}
    </span>
  );
}
