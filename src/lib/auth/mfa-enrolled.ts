import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifiedTotpUserIds } from "./mfa";

/** Auth admin lists at most this many accounts per page. */
const PAGE = 1000;

/**
 * Who has a verified authenticator, asked of the Auth admin API: every
 * account, page by page, with the factors each carries.
 *
 * The Users page reads Supabase's factor table in one query when the
 * database role may see the auth schema. On a project where that grant
 * did not take (Supabase does not always let `postgres` hand out the auth
 * schema), the column read "Unavailable" and the Reset beside a paired
 * account was never offered — this is the same answer by the road the
 * reset itself already uses. Null when this fails too, so the column can
 * say so rather than show everyone unpaired.
 */
export async function enrolledUserIdsViaAdmin(): Promise<Set<string> | null> {
  try {
    const admin = createSupabaseAdminClient();
    const accounts: Array<{ id: string; factors?: Array<{ id: string; factor_type: string; status: "verified" | "unverified" }> }> = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
      if (error) return null;
      accounts.push(...data.users);
      if (data.users.length < PAGE) break;
    }
    return verifiedTotpUserIds(accounts);
  } catch {
    return null;
  }
}
