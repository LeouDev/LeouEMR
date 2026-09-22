import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { graceUntilSetting, mfaDecision, todayUtc, type AssuranceLevel } from "./mfa";
import { applyViewAs, VIEW_AS_COOKIE } from "./view-as";

export type UserRole = "admin" | "manager" | "supervisor" | "agent" | "trainer" | "sme";
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
  /**
   * Set only while an administrator is looking at the app as a manager
   * (src/lib/auth/view-as.ts): the role they really hold, so the toggle
   * back can be offered. Absent otherwise.
   */
  actualRole?: UserRole;
}

/**
 * Resolves the authenticated caller to their application user record.
 *
 * Identity comes from the `x-user-id` header — set by middleware
 * (src/middleware.ts) after ITS OWN verification of the session token's
 * signature against the project's public signing key (`getClaims()`,
 * falling back to a network `getUser()` only if that key cannot be
 * fetched), never from a client-supplied value: a
 * regular request header of the same name is overwritten by middleware's
 * own `.set()` before the page ever sees it, so nothing arriving from
 * outside can forge it. Role and status come from the `users` table read
 * through Drizzle. Every authorization decision in the app must start
 * here — never from a request body, query param, or a header this
 * function didn't itself trust middleware to set.
 *
 * Deliberately does NOT call `supabase.auth.getUser()` again here. It used
 * to — verified server-side felt like the safer default — but that ran a
 * second, independent network re-verification (and possible token refresh)
 * on every single page render, racing middleware's own call over the same
 * single-use refresh token: confirmed live via Supabase's auth logs
 * showing up to 6 concurrent /token refresh requests within about a
 * second, all but one failing with "Refresh Token Not Found" and bouncing
 * a genuinely signed-in user back to /login. Worse, this client's own
 * cookie writes are a no-op in a Server Component (see
 * src/lib/supabase/server.ts's comment), so any refresh it triggered was
 * silently discarded anyway — pure downside, no upside.
 *
 * Wrapped in React's `cache` so a render that asks more than once — a page
 * and the components it renders — costs one query rather than repeating
 * it. The cache is per-request, so it cannot leak one user's identity into
 * another's render.
 */
export interface SessionAssurance {
  /**
   * What the session has proved: a password alone, or a password and an
   * authenticator code. Null when the middleware verified the session but
   * could not read the level (its slower network path); the step is then
   * not enforced, as the middleware itself does not enforce it.
   */
  aal: AssuranceLevel | null;
  /** Whether this request is a server action rather than a page render. */
  isAction: boolean;
}

/** What the middleware verified about this request's session — see middleware.ts. */
export const sessionAssurance = cache(async function sessionAssurance(): Promise<SessionAssurance> {
  const headerList = await headers();
  const aal = headerList.get("x-session-aal");
  return {
    aal: aal === "aal2" || aal === "aal1" ? aal : null,
    isAction: headerList.get("x-request-kind") === "action",
  };
});

export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const headerList = await headers();
  const userId = headerList.get("x-user-id");
  if (!userId) return null;

  const [record] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!record) return null;

  // A role that owes its second step may render the pages that get it
  // there (the shell layout sends it to /mfa), but must not act: every
  // server action starts here, so a password-only session calling one
  // directly is refused as if signed out.
  const { aal, isAction } = await sessionAssurance();
  if (
    isAction &&
    aal !== null &&
    mfaDecision({ role: record.role, aal, today: todayUtc(), graceUntil: graceUntilSetting() }) === "enrol"
  ) {
    return null;
  }
  // An administrator may be looking at the app as one of its managers; the
  // second step above was judged on their real role, which needs it too.
  const cookieStore = await cookies();
  return applyViewAs(record, cookieStore.get(VIEW_AS_COOKIE)?.value);
});
