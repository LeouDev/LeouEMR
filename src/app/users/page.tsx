import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, users } from "@/lib/db/schema";
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
      managerName: users.managerName,
      // What they told us they are at sign-up. A claim, not a granted role.
      signedUpAs: employeeProfiles.position,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .orderBy(desc(users.status), asc(users.name));

  // The names a manager's span can be linked to are exactly those present in
  // the imported data — offering free text would just recreate the typo that
  // made a span silently empty.
  const managerNames = (
    await db
      .selectDistinct({ name: employees.managerName })
      .from(employees)
      .where(isNotNull(employees.managerName))
  )
    .map((r) => r.name)
    .filter((n): n is string => Boolean(n))
    .sort();

  const pending = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/users" />
      <PageBand title="Users" subtitle="Accounts, roles and employee links" />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <p className="max-w-2xl text-sm text-muted">
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
          <UserTable
            users={rows as UserRow[]}
            currentUserId={user.id}
            managerNames={managerNames}
          />
        </Card>
      </main>
    </div>
  );
}
