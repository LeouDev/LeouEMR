import { asc, desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { UserTable, type UserRow } from "./user-table";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin") redirect("/dashboard");

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      employeeEid: users.employeeEid,
    })
    .from(users)
    .orderBy(desc(users.status), asc(users.name));

  const pending = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/users" />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            New signups arrive as pending agents. Assign a role, activate the account, and link it to
            an employee ID — that link is what scopes a supervisor to their team and an agent to
            their own record.
          </p>
        </div>

        <Card>
          <CardHeader
            title="Accounts"
            subtitle={
              pending > 0
                ? `${pending} awaiting approval`
                : `${rows.length} account${rows.length === 1 ? "" : "s"}`
            }
          />
          <UserTable users={rows as UserRow[]} currentUserId={user.id} />
        </Card>
      </main>
    </div>
  );
}
