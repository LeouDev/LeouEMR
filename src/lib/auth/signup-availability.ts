/**
 * Why a sign-up would be refused by the database, said in plain words.
 *
 * The sign-up trigger (drizzle/0026_profile_msid_trigger.sql) writes the
 * account row and the 201 profile in one transaction, and the tables enforce
 * one account per email, per employee ID and per MSID. When one of those is
 * already taken the whole sign-up rolls back, and all Supabase can say is
 * "Database error saving new user" — which tells the person nothing about
 * what to do. The page now asks this first, so the refusal names the field.
 *
 * Pure: the caller passes what the database already holds, so every wording
 * below can be pinned down in a test.
 */
export interface SignupClaims {
  email: string;
  employeeEid: string;
  msid: string;
}

export interface ExistingRegistrations {
  /** Emails already on an account row (compared case-insensitively). */
  emails: string[];
  /** Employee IDs already linked to an account or carried by a 201 profile. */
  employeeEids: string[];
  /** MSIDs already on a 201 profile (compared case-insensitively). */
  msids: string[];
}

/**
 * One message for any clash, on purpose. Saying which of the three was
 * taken would let anyone with the sign-up page find out whether a given
 * email, employee ID or MSID is registered here; the person it belongs to
 * already knows, and an administrator can see the actual conflict.
 */
export const SIGNUP_TAKEN_MESSAGE =
  "Some of these details are already registered to an account. Sign in with that account, or ask an administrator if you think this is a mistake.";

export function signupConflict(claims: SignupClaims, existing: ExistingRegistrations): string | null {
  const email = claims.email.trim().toLowerCase();
  if (email && existing.emails.some((e) => e.toLowerCase() === email)) return SIGNUP_TAKEN_MESSAGE;

  const eid = claims.employeeEid.trim();
  if (eid && existing.employeeEids.includes(eid)) return SIGNUP_TAKEN_MESSAGE;

  const msid = claims.msid.trim().toLowerCase();
  if (msid && existing.msids.some((m) => m.toLowerCase() === msid)) return SIGNUP_TAKEN_MESSAGE;

  return null;
}

/**
 * Whether an address may sign up at all: on one of the company domains
 * (`SIGNUP_EMAIL_DOMAINS`), or anywhere when none are configured.
 */
export function signupDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  return domains.includes(email.slice(at + 1).trim().toLowerCase());
}

export function signupDomainMessage(domains: readonly string[]): string {
  const list = domains.map((d) => `@${d}`).join(" or ");
  return `Sign up with your company email address (${list}).`;
}

export const SIGNUP_DATABASE_ERROR =
  "Your account could not be created. The email, employee ID or MSID may already be registered — sign in if you have an account, or ask an administrator.";

export function describeSignupError(message: string): string {
  return /database error saving new user/i.test(message) ? SIGNUP_DATABASE_ERROR : message;
}
