/**
 * Copies every account's role into its Supabase Auth metadata.
 *
 * The middleware decides from the session token alone whether a session
 * must have taken its second step (src/lib/auth/mfa.ts), and the role it
 * reads there is app_metadata.role. The Users page keeps that in step
 * whenever a role is saved; this writes it for every account that
 * existed before, once. Tokens pick the claim up on their next refresh,
 * within the hour, or at the next sign-in.
 *
 *   npm run sync:auth-roles
 */
import { db } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const admin = createSupabaseAdminClient();
const rows = await db.select({ id: users.id, email: users.email, role: users.role }).from(users);

let done = 0;
for (const row of rows) {
  const { error } = await admin.auth.admin.updateUserById(row.id, { app_metadata: { role: row.role } });
  if (error) {
    console.error(`  ${row.email}: ${error.message}`);
    continue;
  }
  done += 1;
}
console.log(`Recorded the role on ${done} of ${rows.length} account(s).`);
process.exit(0);
