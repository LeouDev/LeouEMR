import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand, StatusBadge, formatWeek } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { getActionItems, getScopedEmployeeName } from "@/lib/queries/performance";

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; employee?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const openOnly = params.all !== "1";
  // Only a real id is ever handed to the queries below. Anything else —
  // a truncated link, a hand-edited URL — used to reach Postgres as a uuid
  // comparison and throw a cast error, so the whole page fell over onto the
  // generic error screen; now it simply means "no employee filter".
  const employeeFilter = isUuid(params.employee) ? params.employee : undefined;
  // The filtered person's name is looked up alongside the list rather than
  // taken off its first row: an employee with no open items — the common
  // case when arriving from a roster link — used to be labelled "this
  // employee", which told the reader nothing about whose empty list this was.
  // Scoped the same way the list is, so the name of someone outside the
  // caller's span is never revealed by guessing an id.
  const [items, filteredEmployee] = await Promise.all([
    getActionItems(user, { openOnly, employeeId: employeeFilter }),
    employeeFilter ? getScopedEmployeeName(user, employeeFilter) : Promise.resolve(null),
  ]);
  const filteredEmployeeName = employeeFilter ? (filteredEmployee ?? "this employee") : null;

  return (
    <>
      <PageBand title="Action items" subtitle="Open performance threads" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        {filteredEmployeeName && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-orange-brand-100 px-4 py-2.5 text-sm">
            <span className="text-ink">
              Filtered to <span className="font-semibold">{filteredEmployeeName}</span>
            </span>
            <Link
              href={openOnly ? "/action-items" : "/action-items?all=1"}
              className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
            >
              Clear filter
            </Link>
          </div>
        )}

        <Card>
          <CardHeader
            title={openOnly ? "Active items" : "All items"}
            subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
            action={
              <Link
                href={`${openOnly ? "/action-items?all=1" : "/action-items"}${employeeFilter ? `${openOnly ? "&" : "?"}employee=${employeeFilter}` : ""}`}
                className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
              >
                {openOnly ? "Show resolved too" : "Show active only"}
              </Link>
            }
          />

          {items.length === 0 ? (
            <EmptyState
              title="No action items"
              description={
                filteredEmployeeName
                  ? `${filteredEmployeeName} has no ${openOnly ? "active " : ""}action items.`
                  : "Action items are created automatically when a KPI fails its threshold."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Item</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">KPI</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                    <th className="px-3 py-2.5 font-semibold text-ink">Progress</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Opened</th>
                    <th className="px-6 py-2.5 font-semibold text-ink">RCA / Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.actionItemId} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                      <td className="px-6 py-2">
                        <Link
                          href={`/action-items/${item.actionItemId}`}
                    prefetch={false}
                          className="font-mono text-xs font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {item.actionItemCode}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/employees/${item.employeeId}`}
                    prefetch={false}
                          className="text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {item.employeeName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-ink">{item.kpiName}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                        {item.consecutivePassingWeeks} / 4
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{formatWeek(item.openedWeek)}</td>
                      <td className="px-6 py-2 text-xs">
                        <span className={item.hasRca ? "text-pass" : "text-muted"}>
                          {item.hasRca ? "RCA ✓" : "RCA —"}
                        </span>
                        <span className="mx-1 text-line">|</span>
                        <span className={item.hasActionPlan ? "text-pass" : "text-muted"}>
                          {item.hasActionPlan ? "Plan ✓" : "Plan —"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
