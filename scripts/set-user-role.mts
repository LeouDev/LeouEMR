/**
 * Sets a user's role, activates their account, and optionally links it to a
 * person in the imported data.
 *
 * Exists to bootstrap the first administrator: every signup lands as a
 * pending agent (see drizzle/0001_auth_trigger_and_rls.sql), so without
 * this there is no way to create the first admin who can then approve
 * everyone else through the UI.
 *
 * The EID is what role scoping keys on — a supervisor sees employees whose
 * supervisorEid matches it, an agent sees only their own record.
 *
 *   npm run set-role -- someone@example.com admin
 *   npm run set-role -- sup@example.com supervisor 900219893
 */
import postgres from "postgres";

const [email, role, employeeEid] = process.argv.slice(2);
const ROLES = ["admin", "manager", "supervisor", "agent"];

if (!email || !ROLES.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${ROLES.join("|")}> [employeeEid]`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run with the env from .env.local");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

const rows = await sql`
  update public.users
  set role = ${role}::user_role,
      status = 'active',
      employee_eid = coalesce(${employeeEid ?? null}, employee_eid)
  where email = ${email}
  returning email, name, role, status, employee_eid
`;

if (rows.length === 0) {
  console.error(`No user found with email ${email}. They must sign up first.`);
  await sql.end();
  process.exit(1);
}

console.log(
  `Updated: ${rows[0].email} -> role=${rows[0].role}, status=${rows[0].status}, eid=${rows[0].employee_eid ?? "(unlinked)"}`,
);
await sql.end();
