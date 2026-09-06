import Link from "next/link";
import { formatMetric, formatWeek } from "@/components/ui";
import { EwsRiskBadge } from "./ews-panel";
import type { EmployeeMatrix } from "@/lib/queries/performance";

const CELL = "min-w-28 border-l border-line/60 px-3 py-2 text-right font-mono text-sm tabular-nums";
const STICKY = "sticky left-0 z-10 min-w-52 bg-surface px-6 py-2";

function toneFor(status: "pass" | "warning" | "fail"): string {
  if (status === "fail") return "bg-fail-bg text-fail";
  if (status === "warning") return "bg-warn-bg text-warn";
  return "text-navy-900";
}

/**
 * The whole development history in one horizontally scrollable grid.
 *
 * A supervisor reads progress left to right rather than clicking through a
 * week at a time, so a run of passing weeks — or a relapse — is visible at
 * a glance. The first column is sticky so the KPI stays anchored while
 * scrolling through the weeks.
 */
export function ProgressMatrix({ matrix }: { matrix: EmployeeMatrix }) {
  const { weeks, kpis, cells, ews, issues } = matrix;

  if (weeks.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-medium text-navy-900">No performance data yet</p>
        <p className="mt-1 text-sm text-muted">Import a workbook to populate this view.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-cream">
            <th className={`${STICKY} border-r border-line bg-cream text-left font-semibold text-navy-800`}>
              KPI
            </th>
            {weeks.map((week) => (
              <th
                key={week}
                className="min-w-28 border-l border-line/60 px-3 py-2.5 text-right font-semibold whitespace-nowrap text-navy-800"
              >
                {formatWeek(week)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {kpis.map((kpi) => (
            <tr key={kpi.code} className="border-b border-line/70 last:border-0">
              <td className={`${STICKY} border-r border-line font-medium text-navy-900`}>
                {kpi.name}
              </td>
              {weeks.map((week) => {
                const cell = cells.get(`${kpi.code}|${week}`);
                if (!cell) {
                  return (
                    <td key={week} className={`${CELL} text-muted/50`}>
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={week}
                    className={`${CELL} ${toneFor(cell.status)}`}
                    title={
                      `${formatMetric(cell.actualValue, kpi.code)} against ` +
                      `${formatMetric(cell.targetValue, kpi.code)}` +
                      (cell.sampleSize ? ` · ${cell.sampleSize} records` : "")
                    }
                  >
                    {formatMetric(cell.actualValue, kpi.code)}
                  </td>
                );
              })}
            </tr>
          ))}

          {ews.size > 0 && (
            <tr className="border-t-2 border-line bg-cream/40">
              <td className={`${STICKY} border-r border-line bg-cream/40 font-medium text-navy-900`}>
                EWS risk
              </td>
              {weeks.map((week) => {
                const risk = ews.get(week);
                return (
                  <td key={week} className="min-w-28 border-l border-line/60 px-3 py-2 text-right">
                    {risk ? (
                      <EwsRiskBadge riskLevel={risk.riskLevel} score={risk.score} />
                    ) : (
                      <span className="font-mono text-sm text-muted/50">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>

      {issues.length > 0 && (
        <table className="w-full border-collapse border-t-2 border-line text-sm">
          <thead>
            <tr className="border-b border-line bg-cream">
              <th className={`${STICKY} border-r border-line bg-cream text-left font-semibold text-navy-800`}>
                Development item
              </th>
              {weeks.map((week) => (
                <th
                  key={week}
                  className="min-w-28 border-l border-line/60 px-3 py-2.5 text-right font-semibold whitespace-nowrap text-navy-800"
                >
                  {formatWeek(week)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.actionItemId} className="border-b border-line/70 last:border-0">
                <td className={`${STICKY} border-r border-line`}>
                  <Link
                    href={`/action-items/${issue.actionItemId}`}
                    className="font-medium text-navy-900 underline-offset-4 hover:text-orange-brand hover:underline"
                  >
                    {issue.kpiName}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted">{issue.actionItemCode}</span>
                  <p className="mt-0.5 text-xs text-muted">
                    {issue.consecutivePassingWeeks} / 4 consecutive
                    {!issue.hasRca && " · RCA pending"}
                    {issue.hasRca && !issue.hasActionPlan && " · plan pending"}
                  </p>
                </td>
                {weeks.map((week) => {
                  const point = issue.history.get(week);
                  const opened = issue.openedWeek === week;
                  if (!point) {
                    return (
                      <td key={week} className={`${CELL} text-muted/40`}>
                        ·
                      </td>
                    );
                  }
                  return (
                    <td
                      key={week}
                      className={`${CELL} ${point.result === "fail" ? "bg-fail-bg text-fail" : "text-pass"}`}
                      title={
                        opened
                          ? "Opened this week"
                          : point.result === "fail"
                            ? "Failed — counter reset"
                            : `Monitoring ${point.consecutiveCountAfter} / 4`
                      }
                    >
                      {point.result === "fail" ? (opened ? "opened" : "reset") : `${point.consecutiveCountAfter}/4`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
