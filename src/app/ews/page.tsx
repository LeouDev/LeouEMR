import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, EwsRiskBadge, PageBand, StatCard, formatWeek } from "@/components/ui";
import { EWS_RISK_GUIDANCE } from "@/lib/ews/engine";
import { getCurrentUser } from "@/lib/auth/session";
import { getEwsBoard } from "@/lib/queries/ews";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/** How many rows to show before the table scrolls, on a large board. */
const VISIBLE_ROWS = 20;

const ATTRITION_LABELS: Record<string, string> = {
  black: "Resignation / termination",
  absconding: "Absconding",
  loa: "Leave of absence",
  maternity: "Maternity",
};

/**
 * Retention risk across the caller's span — supervisors, managers and
 * administrators only. An agent's own record already shows on their
 * employee page (read-only), which is not this: a board is for someone
 * responsible for more than one person.
 *
 * The concept and the scoring are unchanged from the existing per-employee
 * assessment (see src/lib/ews/engine.ts) — this page only adds the missing
 * view of it: everyone side by side, worst first, so a coverage gap or a
 * cluster of risk is visible without opening each person one at a time.
 */
export default async function EwsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // A hidden tab is not a permission check; every restricted page re-checks.
  if (user.role === "agent") redirect("/dashboard");

  const board = await getEwsBoard(user);
  const { totals } = board;
  const showSupervisor = user.role !== "supervisor";
  const scrolls = board.rows.length > VISIBLE_ROWS;

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/ews" />
      <PageBand title="Early Warning Signs" subtitle="Retention risk across your team" />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Critical" value={totals.black} tone={totals.black > 0 ? "fail" : "default"} hint={EWS_RISK_GUIDANCE.BLACK} />
          <StatCard label="At risk" value={totals.red} tone={totals.red > 0 ? "fail" : "default"} />
          <StatCard label="Watch" value={totals.yellow} tone={totals.yellow > 0 ? "warn" : "default"} />
          <StatCard label="Stable" value={totals.green} tone="pass" />
          <StatCard
            label="Not yet assessed"
            value={totals.unassessed}
            hint="No judgement recorded yet"
          />
        </div>

        <Card>
          <CardHeader
            title="Board"
            subtitle={
              board.rows.length === 0
                ? "No one in scope"
                : scrolls
                  ? `Showing ${VISIBLE_ROWS} of ${board.rows.length} — most at risk first, scroll for the rest`
                  : "Most at risk first, then unassessed, then stable"
            }
          />

          {board.rows.length === 0 ? (
            <EmptyState
              title="Nobody in scope"
              description="Employees appear here once they are linked to your span."
            />
          ) : (
            <div
              className="overflow-x-auto"
              style={
                scrolls ? { maxHeight: `${VISIBLE_ROWS * 57 + 42}px`, overflowY: "auto" } : undefined
              }
            >
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className={scrolls ? "sticky top-0 z-20" : undefined}>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Employee</th>
                    {showSupervisor && <th className={HEAD}>Supervisor</th>}
                    <th className={HEAD}>Risk</th>
                    <th className={HEAD}>Status</th>
                    <th className={HEAD}>Last assessed</th>
                    <th className={`${HEAD} px-6`}>Observations</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr
                      key={row.employeeId}
                      className="border-b-2 border-line bg-surface last:border-0 hover:bg-cream/60"
                    >
                      <td className="px-6 py-3 align-top">
                        <Link
                          href={`/employees/${row.employeeId}`}
                          prefetch={false}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                      </td>
                      {showSupervisor && (
                        <td className="px-3 py-3 align-top text-xs text-muted">
                          {row.supervisorName ?? "—"}
                        </td>
                      )}
                      <td className="px-3 py-3 align-top">
                        {row.riskLevel ? (
                          <EwsRiskBadge riskLevel={row.riskLevel} score={row.score ?? undefined} />
                        ) : (
                          <span className="bg-line px-2.5 py-0.5 text-xs font-semibold text-muted">
                            Not assessed
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs">
                        {row.capActive && <span className="mr-2 text-warn">Active CAP</span>}
                        {row.attrition && row.attrition !== "none" && (
                          <span className="font-semibold text-fail">
                            {ATTRITION_LABELS[row.attrition] ?? row.attrition}
                          </span>
                        )}
                        {!row.capActive && (!row.attrition || row.attrition === "none") && (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-muted">
                        {row.week ? (
                          <>
                            {formatWeek(row.week)}
                            {row.assessedByName && (
                              <span className="block text-[11px]">{row.assessedByName}</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-3 align-top text-xs text-muted">
                        {row.notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
