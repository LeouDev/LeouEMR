/**
 * Who needs a second step at sign-in, and what to do with a session that
 * has not taken it yet.
 *
 * The second step is a time-based code from an authenticator app, kept by
 * Supabase Auth: a session that has passed it carries assurance level
 * "aal2" in its token, a password-only session "aal1". Admin, manager and
 * team leader accounts see whole teams' records, so they must reach aal2
 * before any page or action; everyone else may enrol if they like.
 */

export const MFA_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "supervisor"]);

export type AssuranceLevel = "aal1" | "aal2";

export function mfaRequiredFor(role: string): boolean {
  return MFA_ROLES.has(role);
}

/**
 * "ok": nothing to do. "enrol": send them to the second step before
 * anything else. "grace": required, not yet taken, but the deadline the
 * deployment set has not passed — let them in and remind them.
 */
export type MfaDecision = "ok" | "enrol" | "grace";

export function mfaDecision(input: {
  role: string;
  aal: AssuranceLevel | string | null | undefined;
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** YYYY-MM-DD: enforcement starts on this day; unset means now. */
  graceUntil?: string | null;
}): MfaDecision {
  if (!mfaRequiredFor(input.role)) return "ok";
  if (input.aal === "aal2") return "ok";
  if (input.graceUntil && input.today < input.graceUntil) return "grace";
  return "enrol";
}

/** Pages a required-role session may use before its second step. */
export const MFA_EXEMPT_PREFIXES = ["/mfa", "/login", "/auth", "/pending", "/reset-password"] as const;

export function mfaExempt(pathname: string): boolean {
  return MFA_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The enforcement date from the environment, or null when enforcement is immediate. */
export function graceUntilSetting(): string | null {
  const value = process.env.MFA_GRACE_UNTIL?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
