import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, PageBand, StatCard, StatusBadge } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { SUSTAINED_WEEKS, getDevelopmentBoard } from "@/lib/queries/development";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/** Progress toward the four sustained weeks that close an issue. */
function Progress({ weeks }: { weeks: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-0.5">
        {Array.from({ length: SUSTAINED_WEEKS }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 ${i < weeks ? "bg-pass" : "bg-line"}`}
            aria-hidden
          />
        ))}
      </span>
      <span className="font-mono text-xs text-muted tabular-nums">
        {weeks}/{SUSTAINED_WEEKS}
      </span>
    </span>
  );
}

/**
 * The Development Hub: everyone with open development work, and what each
 * of them needs next.
 *
 * Grouped by person rather than by action item, because a supervisor develops
 * people — someone with three open items needs one conversation, not three.
 * Ordered by who is blocked on the supervisor rather than by severity: an item
 * with no root cause recorded cannot move at all, while one three weeks into
 * monitoring is already working.
 */
export default async function DevelopmentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const board = await getDevelopmentBoard(user);
  const { totals } = board;
  const isAgent = user.role === "agent";

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/development" />
      <PageBand
        title="Development Hub"
        subtitle={
          isAgent
            ? "Your individual development plan"
            : "Individual development plans across your team"
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label={isAgent ? "My open items" : "People in development"}
            value={isAgent ? totals.openItems : totals.peopleInDevelopment}
            hint={isAgent ? undefined : `${totals.openItems} open items`}
          />
          <StatCard
            label="Need root cause"
            value={totals.missingRca}
            tone={totals.missingRca > 0 ? "fail" : "default"}
            hint="Cannot progress until written"
          />
          <StatCard
            label="Need action plan"
            value={totals.missingPlan}
            tone={totals.missingPlan > 0 ? "warn" : "default"}
          />
          <StatCard
            label="Awaiting acknowledgement"
            value={totals.awaitingAcknowledgement}
            tone={totals.awaitingAcknowledgement > 0 ? "warn" : "default"}
            hint="With the agent"
          />
          <StatCard
            label="Nearing close"
            value={totals.nearingClose}
            tone="pass"
            hint={`${SUSTAINED_WEEKS - 1}+ sustained weeks`}
          />
        </div>

        <Card>
          <CardHeader
            title={isAgent ? "My development plan" : "Development board"}
            subtitle={
              board.rows.length === 0
                ? "Nothing in development"
                : "Ordered by what is most blocked, not by severity — an item with no root cause cannot move at all"
            }
          />

          {board.rows.length === 0 ? (
            <EmptyState
              title="Nothing in development"
              description={
                isAgent
                  ? "You have no open action items. Anything raised will appear here with the plan agreed with your supervisor."
                  : "No one on your team has an open action item. They appear here as soon as a KPI fails."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>{isAgent ? "Plan" : "Employee"}</th>
                    <th className={HEAD}>In development for</th>
                    <th className={HEAD}>Open</th>
                    <th className={HEAD}>Sustained progress</th>
                    <th className={HEAD}>Next step</th>
                    <th className={`${HEAD} px-6`}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.employeeId} className="border-b-2 border-line last:border-0 hover:bg-cream/60">
                      <td className="px-6 py-3">
                        <Link
                          href={`/employees/${row.employeeId}`}
                          prefetch={false}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.employeeName}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">{row.kpis.join(", ")}</td>
                      <td className="px-3 py-3 font-mono tabular-nums text-ink">{row.openItems}</td>
                      <td className="px-3 py-3">
                        <Progress weeks={row.bestProgress} />
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`text-xs font-semibold ${
                            row.urgency <= 1 ? "text-fail" : row.urgency <= 3 ? "text-warn" : "text-muted"
                          }`}
                        >
                          {row.nextStep}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <Link
                          href={`/employees/${row.employeeId}`}
                          prefetch={false}
                          className="text-sm font-semibold text-orange-brand underline-offset-4 hover:underline"
                        >
                          Open plan →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {board.rows.length > 0 && (
          <Card>
            <CardHeader
              title="Open items in detail"
              subtitle="Every action item behind the board above"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Item</th>
                    {!isAgent && <th className={HEAD}>Employee</th>}
                    <th className={HEAD}>KPI</th>
                    <th className={HEAD}>Status</th>
                    <th className={HEAD}>RCA</th>
                    <th className={HEAD}>Plan</th>
                    <th className={`${HEAD} px-6`}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.flatMap((row) =>
                    row.items.map((item) => (
                      <tr
                        key={item.actionItemId}
                        className="border-b-2 border-line last:border-0 hover:bg-cream/60"
                      >
                        <td className="px-6 py-2.5">
                          <Link
                            href={`/action-items/${item.actionItemId}`}
                            prefetch={false}
                            className="font-mono text-xs text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                          >
                            {item.actionItemCode}
                          </Link>
                        </td>
                        {!isAgent && (
                          <td className="px-3 py-2.5 text-ink">{item.employeeName}</td>
                        )}
                        <td className="px-3 py-2.5 text-muted">{item.kpiName}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={item.hasRca ? "text-pass" : "text-fail"}>
                            {item.hasRca ? "Done" : "Missing"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={item.hasActionPlan ? "text-pass" : "text-fail"}>
                            {item.hasActionPlan ? "Done" : "Missing"}
                          </span>
                        </td>
                        <td className="px-6 py-2.5">
                          <Progress weeks={item.consecutivePassingWeeks} />
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
