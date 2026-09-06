import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "manager" | "supervisor" | "agent";
export type UserStatus = "active" | "pending" | "disabled";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  /** Links the account to a person in the imported data; null until linked. */
  employeeEid: string | null;
  /** For managers: the manager name used in the source data. Null until linked. */
  managerName: string | null;
}

/**
 * Resolves the authenticated caller to their application user record.
 *
 * Identity comes from Supabase Auth (verified server-side via getUser(),
 * never from a client-supplied value); role and status come from the
 * `users` table read through Drizzle. Every authorization decision in the
 * app must start here — never from a request body, query param or header.
 *
 * Wrapped in React's `cache` so a render that asks more than once — a page
 * and the components it renders — costs one auth round trip and one query
 * rather than repeating both. The cache is per-request, so it cannot leak
 * one user's identity into another's render.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [record] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  return record ?? null;
});
