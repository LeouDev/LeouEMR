import Link from "next/link";
import { EwsRiskBadge, formatMetric, formatWeek } from "@/components/ui";
import { actionItemLinks, cellKey, linkTitle, type CellLink } from "@/lib/development/item-links";
import type { EmployeeMatrix } from "@/lib/queries/performance";

const CELL = "min-w-28 border-l border-line/60 px-3 py-2 font-mono text-sm tabular-nums";
const STICKY = "sticky left-0 z-10 min-w-52 bg-surface px-6 py-2";

function toneFor(status: "pass" | "warning" | "fail" | null): string {
  if (status === "fail") return "bg-fail-bg font-semibold text-fail";
  if (status === "warning") return "bg-warn-bg text-warn";
  // No target means nothing to pass or fail — case rate reads as a plain
  // figure rather than borrowing the green of a measure that cleared a bar.
  if (status === null) return "text-ink";
  return "text-pass";
}

/**
 * The whole development history in one horizontally scrollable grid.
 *
 * A supervisor reads progress left to right rather than clicking through a
 * week at a time, so a run of passing weeks — or a relapse — is visible at
 * a glance. The first column is sticky so the KPI stays anchored while
 * scrolling through the weeks. A figure an action item was tracking that
 * week links to the item — the grid is the index of the plans, which is why
 * there is no separate table of them.
 */
/** A figure that an action item was tracking that week: the whole cell opens the item. */
export function LinkedFigure({ link, children }: { link: CellLink; children: React.ReactNode }) {
  return (
    <Link
      href={`/action-items/${link.actionItemId}`}
      prefetch={false}
      title={linkTitle(link)}
      className="block underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {children}
      {/* A note means the circumstances that week differed from the item's original root cause. */}
      {link.noted && <span aria-label="has a note" className="ml-1.5 inline-block h-1.5 w-1.5 bg-orange-brand align-middle" />}
    </Link>
  );
}

export function ProgressMatrix({ matrix }: { matrix: EmployeeMatrix }) {
  const { weeks, kpis, cells, ews, issues } = matrix;
  const links = actionItemLinks(issues);

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
                const link = links.get(cellKey(kpi.code, week));
                const figure = formatMetric(cell.actualValue, kpi.code);
                const detail =
                  `${figure} against ${formatMetric(cell.targetValue, kpi.code)}` +
                  (cell.sampleSize ? ` · ${cell.sampleSize} records` : "");
                return (
                  <td
                    key={week}
                    className={`${CELL} ${toneFor(cell.status)} ${link ? "p-0" : ""}`}
                    title={link ? undefined : detail}
                  >
                    {link ? (
                      <span className="block px-3 py-2">
                        <LinkedFigure link={link}>{figure}</LinkedFigure>
                      </span>
                    ) : (
                      figure
                    )}
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

    </div>
  );
}
