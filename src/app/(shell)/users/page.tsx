import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, positionEnum, users } from "@/lib/db/schema";
import { ApprovePending } from "./approve-pending";
import { UserTable, type UserRow } from "./user-table";
import { NO_POSITION, UsersFilters } from "./users-filters";

const STATUSES = ["active", "pending", "disabled"] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (value: string | undefined): value is Status =>
  value !== undefined && (STATUSES as readonly string[]).includes(value);

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; position?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : undefined;
  const positions = positionEnum.enumValues;
  const position =
    params.position === NO_POSITION || (params.position && (positions as readonly string[]).includes(params.position))
      ? params.position
      : undefined;

  // The account list and the manager-name list are independent, so they are
  // fetched together rather than one after the other.
  const rowsQuery = db
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
      // The same claim, but for the one field that has a ground truth to
      // check it against: null when unlinked (nothing to flag), true when
      // it resolves to a real roster row, false when it does not — a link
      // set before this check existed, or a typo that slipped through.
      eidMatches: sql<boolean | null>`case when ${users.employeeEid} is null then null else ${employees.id} is not null end`,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .leftJoin(employees, eq(employees.eid, users.employeeEid))
    .orderBy(desc(users.status), asc(users.name));

  // Who has paired an authenticator, straight from Supabase Auth's factor
  // table: one read for the whole page rather than one admin call per row.
  // Null if the read fails (a project where the role cannot see the auth
  // schema): the column then says so rather than showing everyone unpaired.
  const mfaQuery: Promise<Array<{ user_id: string; verified: boolean }> | null> = db
    .execute(
      sql`select user_id, bool_or(status = 'verified') as verified from auth.mfa_factors where factor_type = 'totp' group by user_id`,
    )
    .then((rows) => rows as unknown as Array<{ user_id: string; verified: boolean }>)
    .catch(() => null);

  // The names a manager's span can be linked to are exactly those present in
  // the imported data — offering free text would just recreate the typo that
  // made a span silently empty.
  const [accountRows, managerRows, mfaRows] = await Promise.all([
    rowsQuery,
    db
      .selectDistinct({ name: employees.managerName })
      .from(employees)
      .where(isNotNull(employees.managerName)),
    mfaQuery,
  ]);
  const enrolled = mfaRows === null ? null : new Set(mfaRows.filter((r) => r.verified).map((r) => r.user_id));
  const rows = accountRows.map((row) => ({ ...row, mfaEnrolled: enrolled === null ? null : enrolled.has(row.id) }));
  const managerNames = managerRows
    .map((r) => r.name)
    .filter((n): n is string => Boolean(n))
    .sort();

  // Filtered here rather than in SQL: the whole list is a few dozen rows and
  // is needed anyway for the counts beside the filtered view.
  const shown = rows.filter(
    (row) =>
      (status === undefined || row.status === status) &&
      (position === undefined ||
        (position === NO_POSITION ? row.signedUpAs === null : row.signedUpAs === position)),
  );
  const filtered = status !== undefined || position !== undefined;
  const pendingShown = shown.filter((row) => row.status === "pending" && row.id !== user.id);
  const pendingTotal = rows.filter((row) => row.status === "pending").length;

  return (
    <>
      <PageBand title="Users" subtitle="Accounts, roles and employee links" />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <p className="max-w-2xl text-sm text-muted">
            New signups arrive as pending agents. Assign a role, activate the account, and link it to
            an employee ID — that link is what scopes a supervisor to their team and an agent to
            their own record.
          </p>
        </div>

        <UsersFilters positions={positions} value={{ status: status ?? "", position: position ?? "" }} />

        <Card className="mt-6">
          <CardHeader
            title="Accounts"
            subtitle={
              filtered
                ? `${shown.length} of ${rows.length} account${rows.length === 1 ? "" : "s"}${
                    pendingShown.length > 0 ? ` · ${pendingShown.length} awaiting approval` : ""
                  }`
                : pendingTotal > 0
                  ? `${pendingTotal} awaiting approval`
                  : `${rows.length} account${rows.length === 1 ? "" : "s"}`
            }
            action={<ApprovePending userIds={pendingShown.map((row) => row.id)} />}
          />
          {shown.length === 0 ? (
            <EmptyState
              title="No accounts match these filters"
              description="Try another status or position, or clear the filters."
            />
          ) : (
            <UserTable users={shown as UserRow[]} currentUserId={user.id} managerNames={managerNames} />
          )}
        </Card>
      </main>
    </>
  );
}
