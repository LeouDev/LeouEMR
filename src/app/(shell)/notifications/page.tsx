import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { MarkAllReadButton } from "./mark-all-read";

const TYPE_LABELS: Record<string, string> = {
  "action_item.awaiting_acknowledgement": "An action item needs your acknowledgement",
  "action_item.acknowledged": "An agent acknowledged their action item",
};

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  const unread = rows.filter((row) => row.readAt === null).length;

  return (
    <>
      <PageBand title="Notifications" subtitle="Your inbox" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader
            title="Inbox"
            subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
            action={unread > 0 ? <MarkAllReadButton /> : undefined}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="You'll be notified when an action item needs your attention."
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const payload = row.payload as { actionItemId?: string; employeeName?: string } | null;
                return (
                  <li
                    key={row.id}
                    className={`flex flex-wrap items-center justify-between gap-3 px-6 py-3 ${row.readAt === null ? "bg-orange-brand-100/25" : ""
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {TYPE_LABELS[row.type] ?? row.type}
                      </p>
                      <p className="text-xs text-muted">
                        {payload?.employeeName ? `${payload.employeeName} · ` : ""}
                        {row.createdAt.toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    {payload?.actionItemId && (
                      <Link
                        href={`/action-items/${payload.actionItemId}`}
                    prefetch={false}
                        className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
                      >
                        Open
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
