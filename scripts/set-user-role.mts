/**
 * Sets a user's role and activates their account.
 *
 * Exists to bootstrap the first administrator: every signup lands as a
 * pending agent (see drizzle/0001_auth_trigger_and_rls.sql), so without
 * this there is no way to create the first admin who can then approve
 * everyone else through the UI.
 *
 *   npm run set-role -- someone@example.com admin
 */
import postgres from "postgres";

const [email, role] = process.argv.slice(2);
const ROLES = ["admin", "manager", "supervisor", "agent"];

if (!email || !ROLES.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${ROLES.join("|")}>`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run with the env from .env.local");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

const rows = await sql`
  update public.users
  set role = ${role}::user_role, status = 'active'
  where email = ${email}
  returning email, name, role, status
`;

if (rows.length === 0) {
  console.error(`No user found with email ${email}. They must sign up first.`);
  await sql.end();
  process.exit(1);
}

console.log(`Updated: ${rows[0].email} -> role=${rows[0].role}, status=${rows[0].status}`);
await sql.end();
