import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, PageBand, StatusBadge, formatWeek } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getActionItems } from "@/lib/queries/performance";

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const openOnly = params.all !== "1";
  const items = await getActionItems(user, { openOnly });

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/action-items" />
      <PageBand title="Action items" subtitle="Open performance threads" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Card>
          <CardHeader
            title={openOnly ? "Active items" : "All items"}
            subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
            action={
              <Link
                href={openOnly ? "/action-items?all=1" : "/action-items"}
                className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
              >
                {openOnly ? "Show resolved too" : "Show active only"}
              </Link>
            }
          />

          {items.length === 0 ? (
            <EmptyState
              title="No action items"
              description="Action items are created automatically when a KPI fails its threshold."
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
    </div>
  );
}
