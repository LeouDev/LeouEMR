import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, server-only — never import this from a
 * Client Component. Used exclusively for Storage operations that need to
 * bypass RLS (signed upload URLs, server-side downloads of an uploaded
 * workbook); everything else in this app goes through Drizzle, per
 * server.ts's own note on the architecture.
 */
export function createSupabaseAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
