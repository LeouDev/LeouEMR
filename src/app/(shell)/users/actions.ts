"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, users } from "@/lib/db/schema";

export type UserActionResult = { ok: true } | { ok: false; error: string };

const updateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "manager", "supervisor", "agent"]),
  status: z.enum(["active", "pending", "disabled"]),
  employeeEid: z.string().trim().max(64).optional(),
  managerName: z.string().trim().max(200).optional(),
});

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
  // Only meaningful for managers; cleared otherwise so a demoted account
  // cannot keep a span it no longer has a role for.
  const managerName =
    parsed.data.role === "manager" ? parsed.data.managerName?.trim() || null : null;

  if (employeeEid) {
    // The claim at sign-up is never trusted on its own — same reasoning as
    // the role hint above, applied to the one field here that actually has
    // a ground truth to check against. An EID that matches nobody in the
    // roster is never a legitimate link: it's a typo, or someone guessing,
    // and saving it anyway is what let 5 accounts drift out of sync with
    // the roster before this check existed.
    const [match] = await db.select({ id: employees.id }).from(employees).where(eq(employees.eid, employeeEid)).limit(1);
    if (!match) {
      return {
        ok: false,
        error: `No employee found with ID ${employeeEid} — check for a typo, or confirm they're in the imported roster.`,
      };
    }

    const [clash] = await db.select().from(users).where(eq(users.employeeEid, employeeEid)).limit(1);
    if (clash && clash.id !== parsed.data.userId) {
      return { ok: false, error: `Employee ID ${employeeEid} is already linked to ${clash.name}` };
    }
  }

  await db
    .update(users)
    .set({ role: parsed.data.role, status: parsed.data.status, employeeEid, managerName })
    .where(eq(users.id, parsed.data.userId));

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
    },
    after: { role: parsed.data.role, status: parsed.data.status, employeeEid, managerName },
  });

  revalidatePath("/users");
  return { ok: true };
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
): Promise<{ ok: true; approved: number } | { ok: false; error: string }> {
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

  if (approved.length > 0) {
    await db.insert(auditLog).values(
      approved.map((row) => ({
        actorId: actor.id,
        action: "user.approved",
        entityType: "user",
        entityId: row.id,
        before: { status: "pending" },
        after: { status: "active", role: row.role },
      })),
    );
  }

  revalidatePath("/users");
  return { ok: true, approved: approved.length };
}
