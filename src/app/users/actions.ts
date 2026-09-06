"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";

export type UserActionResult = { ok: true } | { ok: false; error: string };

const updateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "manager", "supervisor", "agent"]),
  status: z.enum(["active", "pending", "disabled"]),
  employeeEid: z.string().trim().max(64).optional(),
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

  if (employeeEid) {
    const [clash] = await db.select().from(users).where(eq(users.employeeEid, employeeEid)).limit(1);
    if (clash && clash.id !== parsed.data.userId) {
      return { ok: false, error: `Employee ID ${employeeEid} is already linked to ${clash.name}` };
    }
  }

  await db
    .update(users)
    .set({ role: parsed.data.role, status: parsed.data.status, employeeEid })
    .where(eq(users.id, parsed.data.userId));

  await db.insert(auditLog).values({
    actorId: actor.id,
    action: "user.updated",
    entityType: "user",
    entityId: parsed.data.userId,
    before: { role: before.role, status: before.status, employeeEid: before.employeeEid },
    after: { role: parsed.data.role, status: parsed.data.status, employeeEid },
  });

  revalidatePath("/users");
  return { ok: true };
}
