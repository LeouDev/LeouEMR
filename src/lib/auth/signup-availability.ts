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

export function signupConflict(claims: SignupClaims, existing: ExistingRegistrations): string | null {
  const email = claims.email.trim().toLowerCase();
  if (email && existing.emails.some((e) => e.toLowerCase() === email)) {
    return "An account already exists for this email address. Sign in instead — or, if that account was removed, ask an administrator to clear it before you sign up again.";
  }

  const eid = claims.employeeEid.trim();
  if (eid && existing.employeeEids.includes(eid)) {
    return `Employee ID ${eid} is already registered to another account. Sign in with that account, or ask an administrator to move the ID to this one.`;
  }

  const msid = claims.msid.trim().toLowerCase();
  if (msid && existing.msids.some((m) => m.toLowerCase() === msid)) {
    return `MSID ${claims.msid.trim()} is already registered to another account. Check the MSID, or ask an administrator.`;
  }

  return null;
}

/**
 * The fallback for a refusal the pre-check did not catch (a race with a
 * second sign-up, or a cause other than a duplicate). Replaces Supabase's
 * bare "Database error saving new user" with something a person can act on.
 */
export const SIGNUP_DATABASE_ERROR =
  "Your account could not be created. The email, employee ID or MSID may already be registered — sign in if you have an account, or ask an administrator.";

export function describeSignupError(message: string): string {
  return /database error saving new user/i.test(message) ? SIGNUP_DATABASE_ERROR : message;
}
