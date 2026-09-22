import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifiedTotpUserIds, type MfaFactor } from "./mfa";

/** How many accounts are asked about at once. */
const CONCURRENCY = 8;

/**
 * Who has a verified authenticator, asked of the Auth admin API one
 * account at a time — `mfa.listFactors`, the same call the reset itself
 * makes. (The account list the admin API returns does not carry factors,
 * so reading it said nobody was paired, the administrator included.)
 *
 * The Users page reads Supabase's factor table in one query when the
 * database role may see the auth schema. On a project where that grant
 * did not take (Supabase does not always let `postgres` hand out the auth
 * schema), the column read "Unavailable" and the Reset beside a paired
 * account was never offered — this is the same answer by the other road.
 * Null when the admin client cannot be built or every read fails, so the
 * column can say so rather than show everyone unpaired.
 */
export async function enrolledUserIdsViaAdmin(userIds: readonly string[]): Promise<Set<string> | null> {
  if (userIds.length === 0) return new Set();
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return null;
  }

  const accounts: Array<{ id: string; factors: MfaFactor[] }> = [];
  let failures = 0;
  const queue = [...userIds];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id });
          if (error || !data) failures += 1;
          else accounts.push({ id, factors: data.factors as MfaFactor[] });
        } catch {
          failures += 1;
        }
      }
    }),
  );
  if (failures === userIds.length) return null;
  return verifiedTotpUserIds(accounts);
}
