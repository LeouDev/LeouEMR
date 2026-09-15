"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { signupDomainAllowed } from "@/lib/auth/signup-availability";
import { parseDomainList } from "@/lib/mail/recipients";
import { db } from "@/lib/db/client";
import { auditLog, employeeAssignments, employees, users } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type UserActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const EMAIL_NOT_CONFIRMED_WARNING =
  "Saved, but their email address could not be marked confirmed. They can still use the link in the confirmation email.";

const updateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "manager", "supervisor", "agent", "trainer", "sme"]),
  status: z.enum(["active", "pending", "disabled"]),
  employeeEid: z.string().trim().max(64).optional(),
  managerName: z.string().trim().max(200).optional(),
  /** The sign-in address; absent leaves it as it is. Lower-cased, as Supabase Auth stores it. */
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address").optional(),
});

/**
 * Whether the roster knows an employee ID: an agent's own row, or a team
 * leader's — who has no row of their own, since the imported workbook
 * lists agents only, and exists in the data solely as the supervisor EID
 * on their reports' rows, on the current roster or in its history.
 */
async function eidKnownToRoster(eid: string): Promise<boolean> {
  const [own, leads, led] = await Promise.all([
    db.select({ id: employees.id }).from(employees).where(eq(employees.eid, eid)).limit(1),
    db.select({ id: employees.id }).from(employees).where(eq(employees.supervisorEid, eid)).limit(1),
    db
      .select({ id: employeeAssignments.id })
      .from(employeeAssignments)
      .where(eq(employeeAssignments.supervisorEid, eid))
      .limit(1),
  ]);
  return own.length > 0 || leads.length > 0 || led.length > 0;
}

/**
 * Updates another account's role, status and data linkage.
 *
 * Admin-only, and an admin cannot change their own role or status here —
 * that would let the last administrator lock everyone out of the system by
 * accident, with no way back in through the UI.
 */
export async function updateUser(input: unknown): Promise<UserActionResult> {
  const actor = await getCurrentUser();
  if (!actor || actor.status !== "active") return { ok: false, error: "Not signed in" };
  if (actor.role !== "admin") return { ok: false, error: "Only administrators can manage users" };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (parsed.data.userId === actor.id) {
    return { ok: false, error: "You cannot change your own role or status" };
  }

  const [before] = await db.select().from(users).where(eq(users.id, parsed.data.userId)).limit(1);
  if (!before) return { ok: false, error: "User not found" };

  const employeeEid = parsed.data.employeeEid?.trim() || null;
  // A manager's span, or the cluster a team leader belongs to while the
  // roster gives them no team; cleared for any other role so a demoted
  // account cannot keep a span it no longer has a role for.
  const managerName =
    parsed.data.role === "manager" || parsed.data.role === "supervisor"
      ? parsed.data.managerName?.trim() || null
      : null;

  // Only a *changed* ID is checked. Re-checking one that was not touched
  // made every other edit to the row — a role, a status, a team leader's
  // cluster — fail on a field the administrator never went near, and did
  // so for every team leader, whose ID the old check (agent rows only)
  // never recognised.
  if (employeeEid && employeeEid !== before.employeeEid) {
    // The claim at sign-up is never trusted on its own — same reasoning as
    // the role hint above, applied to the one field here that actually has
    // a ground truth to check against. An EID that matches nobody in the
    // roster is never a legitimate link: it's a typo, or someone guessing,
    // and saving it anyway is what let 5 accounts drift out of sync with
    // the roster before this check existed.
    if (!(await eidKnownToRoster(employeeEid))) {
      return {
        ok: false,
        error: `No employee or team leader found with ID ${employeeEid} — check for a typo, or confirm they're in the imported roster.`,
      };
    }

    const [clash] = await db.select().from(users).where(eq(users.employeeEid, employeeEid)).limit(1);
    if (clash && clash.id !== parsed.data.userId) {
      return { ok: false, error: `Employee ID ${employeeEid} is already linked to ${clash.name}` };
    }
  }

  // A new sign-in address goes to Supabase Auth first — that is what they
  // sign in with — and only then to the users row, so the two can never
  // disagree because the second write failed. Company domains only, the
  // same rule as sign-up: an account's address is also where the app's
  // own mail (the end-of-day report) may be relayed.
  const email = parsed.data.email !== undefined && parsed.data.email !== before.email.toLowerCase() ? parsed.data.email : null;
  if (email) {
    const domains = parseDomainList(process.env.SIGNUP_EMAIL_DOMAINS);
    if (!signupDomainAllowed(email, domains)) {
      return { ok: false, error: `Use a company email address (${domains.map((d) => `@${d}`).join(" or ")}).` };
    }
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken && taken.id !== parsed.data.userId) {
      return { ok: false, error: "That email address belongs to another account" };
    }
    const changed = await changeSignInEmail(parsed.data.userId, email);
    if (changed !== null) return { ok: false, error: changed };
  }

  await db
    .update(users)
    .set({ role: parsed.data.role, status: parsed.data.status, employeeEid, managerName, ...(email ? { email } : {}) })
    .where(eq(users.id, parsed.data.userId));
  await recordRoleInToken(parsed.data.userId, parsed.data.role);

  // Activating a pending account is the approval, whichever button did it,
  // so it confirms the email address too (see confirmEmail). Re-enabling
  // a disabled account is not an approval and leaves the address as it is.
  const approving = before.status === "pending" && parsed.data.status === "active";
  const emailConfirmed = approving ? await confirmEmail(parsed.data.userId) : null;

  await db.insert(auditLog).values({
    actorId: actor.id,
    action: "user.updated",
    entityType: "user",
    entityId: parsed.data.userId,
    before: {
      role: before.role,
      status: before.status,
      employeeEid: before.employeeEid,
      managerName: before.managerName,
      ...(email ? { email: before.email } : {}),
    },
    after: {
      role: parsed.data.role,
      status: parsed.data.status,
      employeeEid,
      managerName,
      ...(email ? { email } : {}),
      ...(approving ? { emailConfirmed } : {}),
    },
  });

  revalidatePath("/users");
  return emailConfirmed === false ? { ok: true, warning: EMAIL_NOT_CONFIRMED_WARNING } : { ok: true };
}

const approveSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, "Nothing to approve").max(500),
});

/**
 * Activates pending accounts in one go — the "approve all pending" button.
 *
 * Takes the ids the administrator was looking at rather than "every pending
 * account", so a filtered list (say, pending Pharmacy Technicians only)
 * approves exactly what is on screen and nothing that arrived since. Only
 * rows still pending are touched: an account someone else activated or
 * disabled in the meantime is left as they set it. Roles are not changed;
 * a signup stays the agent it arrived as until an administrator assigns
 * more, which is the same fail-closed rule the single-row save follows.
 */
export async function approvePendingUsers(
  input: unknown,
): Promise<{ ok: true; approved: number; unconfirmed: number } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor || actor.status !== "active") return { ok: false, error: "Not signed in" };
  if (actor.role !== "admin") return { ok: false, error: "Only administrators can manage users" };

  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const approved = await db
    .update(users)
    .set({ status: "active" })
    .where(
      and(
        inArray(users.id, parsed.data.userIds),
        eq(users.status, "pending"),
        // Never one's own account, for the same reason updateUser refuses it.
        ne(users.id, actor.id),
      ),
    )
    .returning({ id: users.id, role: users.role });

  const confirmed = await confirmEmails(approved.map((row) => row.id));

  if (approved.length > 0) {
    await db.insert(auditLog).values(
      approved.map((row, index) => ({
        actorId: actor.id,
        action: "user.approved",
        entityType: "user",
        entityId: row.id,
        before: { status: "pending" },
        after: { status: "active", role: row.role, emailConfirmed: confirmed[index] },
      })),
    );
  }

  revalidatePath("/users");
  return { ok: true, approved: approved.length, unconfirmed: confirmed.filter((ok) => !ok).length };
}

/**
 * Sets the account's sign-in address in Supabase Auth, confirmed — an
 * administrator setting it is the check, as with an approval. Returns
 * what to tell the administrator when Supabase refuses (an address
 * already registered there, say), null when it went through.
 */
async function changeSignInEmail(userId: string, email: string): Promise<string | null> {
  try {
    const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, { email, email_confirm: true });
    return error ? `Could not change their sign-in email: ${error.message}` : null;
  } catch {
    return "Could not reach the sign-in service to change their email. Nothing was changed — try again in a moment.";
  }
}

/**
 * Marks the account's email address confirmed in Supabase Auth, as the
 * link in the confirmation email would have.
 *
 * Company mailboxes filter that email often enough — and Supabase's
 * built-in mailer sends few enough per hour — that people were left unable
 * to sign in after an administrator had already approved them. The
 * approval is the stronger check anyway: an administrator vouching for a
 * named colleague on the roster, where the link only proves the mailbox
 * was reachable. Best effort: false when Supabase refused, in which case
 * the approval stands and the link in their inbox still works.
 */
async function confirmEmail(userId: string): Promise<boolean> {
  try {
    const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, { email_confirm: true });
    return !error;
  } catch {
    return false;
  }
}

/** confirmEmail for a batch, a few at a time — one result per id, in order. */
async function confirmEmails(userIds: string[]): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let start = 0; start < userIds.length; start += CONFIRM_BATCH) {
    results.push(...(await Promise.all(userIds.slice(start, start + CONFIRM_BATCH).map(confirmEmail))));
  }
  return results;
}

const CONFIRM_BATCH = 10;

/**
 * Copies the role into the account's auth metadata, where it rides in the
 * session token: that is how the middleware knows, without a database
 * round trip, whether this session must have taken its second step (see
 * src/lib/auth/mfa.ts). Best effort — the shell layout and getCurrentUser
 * apply the same rule from the users table, so a missed copy only costs
 * the fast path, never the enforcement. `npm run sync:auth-roles` copies
 * every account at once.
 */
async function recordRoleInToken(userId: string, role: string): Promise<void> {
  try {
    await createSupabaseAdminClient().auth.admin.updateUserById(userId, { app_metadata: { role } });
  } catch {
    // see above
  }
}

const resetMfaSchema = z.object({ userId: z.string().uuid() });

/**
 * Removes someone's authenticator so they can pair a new one — the way
 * back in after a lost or replaced phone. Their next sign-in shows the
 * pairing screen again; until then a required role cannot get past it,
 * which is the point of the second step.
 */
export async function resetMfa(input: unknown): Promise<UserActionResult> {
  const actor = await getCurrentUser();
  if (!actor || actor.status !== "active") return { ok: false, error: "Not signed in" };
  if (actor.role !== "admin") return { ok: false, error: "Only administrators can reset an authenticator" };

  const parsed = resetMfaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const [target] = await db.select().from(users).where(eq(users.id, parsed.data.userId)).limit(1);
  if (!target) return { ok: false, error: "User not found" };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: target.id });
  if (error) return { ok: false, error: `Could not read their authenticator: ${error.message}` };
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.id });
    if (deleteError) return { ok: false, error: `Could not remove their authenticator: ${deleteError.message}` };
  }

  await db.insert(auditLog).values({
    actorId: actor.id,
    action: "user.mfa_reset",
    entityType: "user",
    entityId: target.id,
    before: { factors: (data?.factors ?? []).length },
    after: { factors: 0 },
  });

  revalidatePath("/users");
  return { ok: true };
}
