"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMetric, metricTone } from "@/components/ui";
import type { TeamKpiCell } from "@/lib/queries/my-stats";

/**
 * One agent's row, already reduced to plain data on the server.
 *
 * Everything crossing into this component is a string, a number or a plain
 * object — no Maps, and nothing imported back the other way. A server module
 * that pulls a value out of a client one gets a reference proxy rather than
 * the value, which is exactly how the dashboard 500'd.
 */
export interface AgentRow {
  employeeId: string;
  name: string;
  eid: string;
  /** KPIs below target among the columns actually shown. */
  below: number;
  open: number;
  cells: Record<string, TeamKpiCell | undefined>;
}

const COLLAPSED = 6;

export function TeamAgentRows({
  kpis,
  rows,
}: {
  kpis: Array<{ code: string; name: string }>;
  rows: AgentRow[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED);

  return (
    <>
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
            {visible.map((row) => (
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
                  {row.open || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > COLLAPSED && (
        <p className="mt-2 text-xs text-muted">
          Showing {visible.length} of {rows.length} ·{" "}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-ink underline-offset-4 hover:text-orange-brand hover:underline"
          >
            {showAll ? "Show fewer" : `All ${rows.length} agents`}
          </button>
        </p>
      )}
    </>
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
