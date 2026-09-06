import Link from "next/link";
import { formatMetric, formatWeek } from "@/components/ui";
import { EwsRiskBadge } from "@/components/ui";
import type { EmployeeMatrix } from "@/lib/queries/performance";

const CELL = "min-w-28 border-l border-line/60 px-3 py-2 font-mono text-sm tabular-nums";
const STICKY = "sticky left-0 z-10 min-w-52 bg-surface px-6 py-2";

function toneFor(status: "pass" | "warning" | "fail"): string {
  if (status === "fail") return "bg-fail-bg font-semibold text-fail";
  if (status === "warning") return "bg-warn-bg text-warn";
  return "text-pass";
}

/**
 * The whole development history in one horizontally scrollable grid.
 *
 * A supervisor reads progress left to right rather than clicking through a
 * week at a time, so a run of passing weeks — or a relapse — is visible at
 * a glance. The first column is sticky so the KPI stays anchored while
 * scrolling through the weeks.
 */
/**
 * Whether a development step is done. Compact enough to sit beside the item
 * name — as its own column it knocked the week grid out of step with the KPI
 * grid above, which is what made the pair hard to read.
 */
function Marker({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      title={done ? `${label} recorded` : `${label} not yet recorded`}
      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-[0.06em] uppercase ${
        done ? "bg-pass-bg text-pass" : "bg-fail-bg text-fail"
      }`}
    >
      {label}
    </span>
  );
}

export function ProgressMatrix({ matrix }: { matrix: EmployeeMatrix }) {
  const { weeks, kpis, cells, ews, issues } = matrix;

  if (weeks.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink">No performance data yet</p>
        <p className="mt-1 text-sm text-muted">Import a workbook to populate this view.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-cream">
            <th className={`${STICKY} border-r border-line bg-cream font-semibold text-ink`}>
              KPI
            </th>
            {weeks.map((week) => (
              <th
                key={week}
                className="min-w-28 border-l border-line/60 px-3 py-2.5 font-semibold whitespace-nowrap text-ink"
              >
                {formatWeek(week)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {kpis.map((kpi) => (
            <tr key={kpi.code} className="border-b border-line/70 last:border-0">
              <td className={`${STICKY} border-r border-line font-medium text-ink`}>
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
              <td className={`${STICKY} border-r border-line bg-cream/40 font-medium text-ink`}>
                EWS risk
              </td>
              {weeks.map((week) => {
                const risk = ews.get(week);
                return (
                  <td key={week} className="min-w-28 border-l border-line/60 px-3 py-2">
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
              <th className={`${STICKY} border-r border-line bg-cream font-semibold text-ink`}>
                Development item
              </th>
              {weeks.map((week) => (
                <th
                  key={week}
                  className="min-w-28 border-l border-line/60 px-3 py-2.5 font-semibold whitespace-nowrap text-ink"
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
                    prefetch={false}
                    className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                  >
                    {issue.kpiName}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted">{issue.actionItemCode}</span>
                  <p className="mt-1 flex items-center gap-1.5">
                    <Marker done={issue.hasRca} label="RCA" />
                    <Marker done={issue.hasActionPlan} label="Plan" />
                    <span className="text-xs text-muted">
                      {issue.consecutivePassingWeeks}/4 sustained
                    </span>
                  </p>
                </td>

                {weeks.map((week) => {
                  const point = issue.history.get(week);
                  if (!point) {
                    return (
                      <td key={week} className={`${CELL} text-muted/40`}>
                        ·
                      </td>
                    );
                  }

                  const opened = issue.openedWeek === week;
                  const failed = point.result === "fail";
                  const noted = issue.noteWeeks.has(week);
                  // A pass logged before the item was acknowledged does not
                  // advance the counter. Showing it as "Pass 0/4" read as no
                  // progress when the truth is that monitoring had not begun.
                  const counted = !failed && point.consecutiveCountAfter > 0;

                  return (
                    <td
                      key={week}
                      className={`${CELL} p-0 ${failed ? "bg-fail-bg" : ""}`}
                    >
                      {/* The whole cell is the link: clicking the week you
                          failed is the natural way to reach its RCA and plan,
                          rather than hunting for the KPI name. */}
                      <Link
                        href={`/action-items/${issue.actionItemId}`}
                        prefetch={false}
                        title={
                          noted
                            ? "This week has a note against the root cause — open to read it"
                            : opened
                            ? "Failed — the week this item opened. Open to record the RCA and action plan."
                            : failed
                              ? "Failed — the four-week counter reset to zero. Open to review the RCA and plan."
                              : counted
                                ? `Passed — ${point.consecutiveCountAfter} of 4 sustained weeks`
                                : "Passed, but before the item was acknowledged — monitoring had not started, so it does not count"
                        }
                        className={`block px-3 py-2 underline-offset-4 hover:underline ${
                          failed ? "font-semibold text-fail" : counted ? "text-pass" : "text-muted"
                        }`}
                      >
                        {failed ? "Fail" : counted ? `Pass ${point.consecutiveCountAfter}/4` : "Pass"}
                        {/* A note means the circumstances that week differed
                            from the item's original root cause. */}
                        {noted && (
                          <span
                            aria-label="has a note"
                            className="ml-1.5 inline-block h-1.5 w-1.5 align-middle bg-orange-brand"
                          />
                        )}
                      </Link>
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
