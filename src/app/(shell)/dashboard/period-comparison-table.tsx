import Link from "next/link";
import { Card, CardHeader, EmptyState, formatMetric, metricTone } from "@/components/ui";
import type { TeamKpiCell, TeamPeriodComparison } from "@/lib/queries/my-stats";

const HEAD = "px-3 py-2 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * One KPI for one employee: this month's value with last month's beneath it.
 *
 * The arrow is driven by the KPI's configured direction, so a falling AHT
 * reads as an improvement while a falling quality score does not.
 */
function Cell({ cell, kpiCode }: { cell: TeamKpiCell | undefined; kpiCode: string }) {
  if (!cell) return <span className="text-muted">—</span>;

  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={`font-mono font-semibold tabular-nums ${metricTone(cell.status)}`}>
        {formatMetric(cell.current, kpiCode)}
      </span>
      {cell.delta !== null && Math.abs(cell.delta) >= 0.005 ? (
        <span
          className={`font-mono text-[10px] tabular-nums ${
            cell.improved === null ? "text-muted" : cell.improved ? "text-pass" : "text-fail"
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

/**
 * KPIs for every direct report over the selected period, against the period
 * before it.
 *
 * Rows are ordered by how many KPIs are failing, so the people needing
 * attention are at the top rather than wherever the alphabet puts them.
 */
export function PeriodComparisonTable({
  data,
  forSelf = false,
}: {
  data: TeamPeriodComparison;
  /** True when the viewer is the only row — an agent looking at themselves. */
  forSelf?: boolean;
}) {
  // DPU and DPO are MBO gates, not standalone results to read across a team:
  // they sit at 100.00 / "no change" for almost everyone and cost two columns
  // of a table that already scrolls sideways. They keep counting toward MBO,
  // and the MBO page still shows which gate someone missed.
  const kpis = data.kpis.filter((kpi) => kpi.code !== "DPU" && kpi.code !== "DPO");

  return (
    <Card className="mt-6">
      <CardHeader
        title={`${data.period.label} by KPI`}
        subtitle={
          forSelf
            ? `${data.period.label} with the change from ${data.previous.label}`
            : `${data.period.label} with the change from ${data.previous.label} · ${data.rows.length} employee${
                data.rows.length === 1 ? "" : "s"
              }`
        }
      />

      {kpis.length === 0 ? (
        <EmptyState
          title="No data this month"
          description={
            forSelf
              ? "Your month-to-date figures appear here once this month's performance data has been imported."
              : "Month-to-date figures appear once this month's performance data has been imported."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${HEAD} sticky left-0 z-10 bg-cream px-6 text-left`}>
                  {forSelf ? "Me" : "Employee"}
                </th>
                {kpis.map((kpi) => (
                  <th key={kpi.code} className={`${HEAD} min-w-28`}>
                    {kpi.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.employeeId} className="border-b-2 border-line last:border-0 hover:bg-cream/60">
                  <td className="sticky left-0 z-10 bg-surface px-6 py-2 text-left">
                    <Link
                      href={`/employees/${row.employeeId}`}
                      prefetch={false}
                      className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  {kpis.map((kpi) => (
                    <td key={kpi.code} className="px-3 py-2">
                      <Cell cell={row.cells[kpi.code]} kpiCode={kpi.code} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
