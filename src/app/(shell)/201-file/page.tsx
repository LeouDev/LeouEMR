import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageBand } from "@/components/ui";
import { employeeScope } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, users } from "@/lib/db/schema";
import type { PersonnelRow } from "@/lib/201-file/filter";
import { PersonnelTable } from "./personnel-table";

/**
 * The 201 file: personnel details for the people reporting to you.
 *
 * Restricted to roles with direct reports. An agent has none, so the page
 * would only ever show their own record — which belongs on their profile,
 * not here.
 */
export default async function TwoOhOneFilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role === "agent") redirect("/dashboard");

  const scope = employeeScope(user);
  if (scope === null) {
    return (
      <>
        <PageBand title="201 file" subtitle="Personnel details for your direct reports" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="Account not linked"
              description="An administrator needs to link this account to an employee ID before your direct reports appear."
            />
          </Card>
        </main>
      </>
    );
  }

  // Direct reports come from the imported hierarchy; their personnel
  // details come from the profile captured at sign-up, which only exists
  // once that person has an account — hence the LEFT join: one read that
  // carries both, instead of the roster first and then a second round trip
  // for the profiles of whoever was in it.
  const reports = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      site: employees.site,
      supervisorName: employees.supervisorName,
      managerName: employees.managerName,
      standing: employees.status,
      profile: {
        employeeEid: employeeProfiles.employeeEid,
        msid: employeeProfiles.msid,
        lastName: employeeProfiles.lastName,
        firstName: employeeProfiles.firstName,
        middleName: employeeProfiles.middleName,
        position: employeeProfiles.position,
        addressLine1: employeeProfiles.addressLine1,
        addressLine2: employeeProfiles.addressLine2,
        cityProvince: employeeProfiles.cityProvince,
        country: employeeProfiles.country,
        zipcode: employeeProfiles.zipcode,
        phoneNumber: employeeProfiles.phoneNumber,
        emergencyContactName: employeeProfiles.emergencyContactName,
        emergencyContactNumber: employeeProfiles.emergencyContactNumber,
        emergencyContactRelationship: employeeProfiles.emergencyContactRelationship,
      },
      email: users.email,
    })
    .from(employees)
    .leftJoin(employeeProfiles, eq(employeeProfiles.employeeEid, employees.eid))
    .leftJoin(users, eq(users.id, employeeProfiles.userId))
    .where(scope === "all" ? undefined : scope)
    .orderBy(asc(employees.name));

  // "Has registered" is decided on a NOT NULL profile column, never on the
  // nested object being null. Drizzle only nulls a nested LEFT-joined object
  // when every column in it comes from the same table (see nullifyMap in
  // drizzle-orm/utils.js) — the first version of this join put users.email
  // inside `profile`, so the object was never nulled and all 600-odd
  // unregistered employees rendered as blank rows in production.
  const rows: PersonnelRow[] = reports.map((r) => ({
    id: r.id,
    eid: r.eid,
    name: r.name,
    site: r.site,
    supervisorName: r.supervisorName,
    managerName: r.managerName,
    standing: r.standing,
    email: r.email,
    profile: r.profile !== null && r.profile.lastName !== null ? r.profile : null,
  }));

  return (
    <>
      <PageBand title="201 file" subtitle="Personnel details for your direct reports" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <p className="max-w-3xl text-sm text-muted">
            Personnel details for your direct reports. Records appear once the person has signed up
            — the details are captured at registration, not imported from the performance data.
          </p>
        </div>

        <PersonnelTable rows={rows} />
      </main>
    </>
  );
}
