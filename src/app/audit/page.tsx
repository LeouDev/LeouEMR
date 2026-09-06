import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";

const ACTION_LABELS: Record<string, string> = {
  "issue.opened": "Action item opened",
  "issue.issue_reopened": "Issue reopened",
  "issue.issue_sustained": "Sustained improvement reached",
  "issue.issue_completed": "Issue completed",
  "rca.created": "RCA entered",
  "rca.updated": "RCA updated",
  "action_plan.created": "Action plan entered",
  "action_plan.updated": "Action plan updated",
  "action_item.sent_to_agent": "Sent to agent",
  "action_item.acknowledged": "Agent acknowledged",
  "skill_target.updated": "Skill target changed",
  "user.updated": "User updated",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin") redirect("/dashboard");

  const params = await searchParams;

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(params.action ? eq(auditLog.action, params.action) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/audit" />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">Audit trail</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every RCA, action plan, acknowledgement, threshold change and automatic issue
            transition. Entries without an actor were written by the import engine rather than a
            person.
          </p>
        </div>

        <Card>
          <CardHeader title="Recent activity" subtitle={`Showing the latest ${rows.length}`} />

          {rows.length === 0 ? (
            <EmptyState title="No activity yet" description="Actions will be recorded here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-cream text-left">
                    <th className="px-6 py-2.5 font-semibold text-navy-800">When</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Who</th>
                    <th className="px-3 py-2.5 font-semibold text-navy-800">Action</th>
                    <th className="px-6 py-2.5 font-semibold text-navy-800">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0">
                      <td className="px-6 py-2 whitespace-nowrap text-xs text-muted">
                        {row.createdAt.toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-3 py-2 text-navy-900">
                        {row.actorName ?? <span className="text-muted">System</span>}
                      </td>
                      <td className="px-3 py-2 text-navy-800">
                        {ACTION_LABELS[row.action] ?? row.action}
                      </td>
                      <td className="px-6 py-2 font-mono text-xs text-muted">
                        {summarize(row.before, row.after)}
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

/** Renders a compact before/after summary without dumping raw JSON at the reader. */
function summarize(before: unknown, after: unknown): string {
  const a = (after ?? {}) as Record<string, unknown>;
  const b = (before ?? {}) as Record<string, unknown>;

  const changed = Object.keys(a)
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => (key in b ? `${key}: ${b[key]} → ${a[key]}` : `${key}: ${a[key]}`));

  return changed.join(", ") || "—";
}
