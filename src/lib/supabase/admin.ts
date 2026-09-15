import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, server-only — never import this from a
 * Client Component. Used exclusively for Storage operations that need to
 * bypass RLS (signed upload URLs, server-side downloads of an uploaded
 * workbook) and for the Auth admin API behind the Users page; everything
 * else in this app goes through Drizzle, per server.ts's own note on the
 * architecture.
 *
 * The variables are checked here rather than left to non-null assertions:
 * supabase-js answers a missing key with "supabaseKey is required.", which
 * names nothing an operator can act on, and in production a server action
 * that throws reaches the browser as an opaque "unexpected response" with
 * the real message only in the server log. The wording follows
 * db/client.ts's own missing-DATABASE_URL error for the same reason.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(
      (name) => name !== false,
    );
    throw new Error(
      `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. Uploading a workbook ` +
        "needs the service-role key to sign the upload URL and to read the file back. Locally, copy " +
        ".env.example to .env.local; in production, set it in the hosting platform's environment " +
        "variables (Supabase: Project Settings > API > service_role).",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
