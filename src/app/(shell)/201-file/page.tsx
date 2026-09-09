import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand } from "@/components/ui";
import { employeeScope } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, users } from "@/lib/db/schema";

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
  // unregistered employees rendered as blank rows in production. The type
  // still says `profile` may be null, so the filter below narrows it too.
  const withProfile = reports.filter(
    (r): r is typeof r & { profile: NonNullable<typeof r.profile> } =>
      r.profile !== null && r.profile.lastName !== null,
  );
  const withoutProfile = reports.length - withProfile.length;

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

        <Card>
          <CardHeader
            title="Direct reports"
            subtitle={
              withoutProfile > 0
                ? `${withProfile.length} of ${reports.length} have registered`
                : `${reports.length} record${reports.length === 1 ? "" : "s"}`
            }
          />

          {withProfile.length === 0 ? (
            <EmptyState
              title="No registered reports yet"
              description={
                reports.length > 0
                  ? `${reports.length} people report to you, but none have signed up yet. Their 201 details appear here once they register.`
                  : "No one currently reports to you."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="sticky left-0 z-10 bg-cream px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      Name
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee ID</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">MSID</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Position</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Email</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Phone</th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Address</th>
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Emergency contact</th>
                  </tr>
                </thead>
                <tbody>
                  {withProfile.map((report) => {
                    const p = report.profile;
                    const address = [
                      p.addressLine1,
                      p.addressLine2,
                      p.cityProvince,
                      p.country,
                      p.zipcode,
                    ]
                      .filter(Boolean)
                      .join(", ");

                    return (
                      <tr key={report.id} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                        <td className="sticky left-0 z-10 bg-surface px-6 py-2">
                          <Link
                            href={`/employees/${report.id}`}
                    prefetch={false}
                            className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                          >
                            {p.lastName}, {p.firstName}
                            {p.middleName ? ` ${p.middleName.charAt(0)}.` : ""}
                          </Link>
                          {report.site && <p className="text-xs text-muted">{report.site}</p>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{p.employeeEid}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted">{p.msid ?? "—"}</td>
                        <td className="px-3 py-2 text-ink">{p.position}</td>
                        <td className="px-3 py-2 text-xs text-muted">{report.email}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted">
                          {p.phoneNumber ?? "—"}
                        </td>
                        <td className="max-w-64 px-3 py-2 text-xs text-muted">{address || "—"}</td>
                        <td className="px-6 py-2 text-xs text-muted">
                          {p.emergencyContactName ? (
                            <>
                              <span className="text-ink">{p.emergencyContactName}</span>
                              {p.emergencyContactRelationship && ` (${p.emergencyContactRelationship})`}
                              {p.emergencyContactNumber && (
                                <span className="block font-mono">{p.emergencyContactNumber}</span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {withoutProfile > 0 && (
          <p className="mt-3 text-sm text-muted">
            {withoutProfile} of your reports have not registered yet, so they have no 201 record.
          </p>
        )}
      </main>
    </>
  );
}
