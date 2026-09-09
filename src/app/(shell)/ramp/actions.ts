"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageActionItems, employeeScope } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { CACHE_TAG, invalidateCache } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { auditLog, employeeRampAssignments, employees } from "@/lib/db/schema";
import { periodContaining } from "@/lib/queries/period";
import { reapplyRampToStoredWeeks, revertRampOnStoredWeeks } from "@/lib/ramp/reapply";

export type RampResult =
  | { ok: true; weeksCorrected: number }
  | { ok: false; error: string };

const setRampSchema = z.object({
  employeeId: z.string().uuid(),
  skillReferenceId: z.string().uuid(),
  rampStartDate: z.string().trim().min(1, "Pick a start date"),
});

/**
 * Confirms the target employee is inside the caller's scope, the same check
 * every other mutation in the app makes before writing — a role check alone
 * would let a supervisor set ramp for a name they merely knew the id of.
 */
async function loadScopedEmployee(user: Awaited<ReturnType<typeof getCurrentUser>>, employeeId: string) {
  if (!user) return null;
  const scope = employeeScope(user);
  if (scope === null) return null;

  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), scope === "all" ? undefined : scope))
    .limit(1);
  return row ?? null;
}

/**
 * Starts or corrects a new hire's ramp. Upserts on (employee, skill) — a
 * supervisor fixing a mistaken start date is the normal case, not an
 * audited history of attempts.
 *
 * Immediately corrects any already-imported weeks the new window covers
 * (see reapplyRampToStoredWeeks) so a ramp set a few days into someone's
 * first week does not wait for next week's import to take effect.
 */
export async function setRampAssignment(input: unknown): Promise<RampResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can set a ramp schedule" };
  }

  const parsed = setRampSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid ramp assignment" };
  }

  const employee = await loadScopedEmployee(user, parsed.data.employeeId);
  if (!employee) return { ok: false, error: "That employee is not in your scope" };

  // A supervisor may pick any day; the schedule is anchored to the week it
  // falls in, matching every other week-based control in the app.
  const rampStartWeek = periodContaining("week", parsed.data.rampStartDate).start;

  await db
    .insert(employeeRampAssignments)
    .values({
      employeeId: parsed.data.employeeId,
      skillReferenceId: parsed.data.skillReferenceId,
      rampStartWeek,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: [employeeRampAssignments.employeeId, employeeRampAssignments.skillReferenceId],
      set: { rampStartWeek, createdBy: user.id, updatedAt: new Date() },
    });

  const { weeksCorrected } = await reapplyRampToStoredWeeks(
    parsed.data.employeeId,
    parsed.data.skillReferenceId,
    rampStartWeek,
  );

  // The ramp targets themselves, and every weekly result the reapply above
  // just rewrote with a new target.
  invalidateCache(CACHE_TAG.ramp, CACHE_TAG.imports);

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ramp.set",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    after: { skillReferenceId: parsed.data.skillReferenceId, rampStartWeek },
  });

  revalidatePath("/ramp");
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { ok: true, weeksCorrected };
}

const clearRampSchema = z.object({
  employeeId: z.string().uuid(),
  skillReferenceId: z.string().uuid(),
});

/** Removes a ramp assignment and restores the skill's steady target on any weeks it had adjusted. */
export async function clearRampAssignment(input: unknown): Promise<RampResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can clear a ramp schedule" };
  }

  const parsed = clearRampSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  const employee = await loadScopedEmployee(user, parsed.data.employeeId);
  if (!employee) return { ok: false, error: "That employee is not in your scope" };

  const { weeksCorrected } = await revertRampOnStoredWeeks(
    parsed.data.employeeId,
    parsed.data.skillReferenceId,
  );

  await db
    .delete(employeeRampAssignments)
    .where(
      and(
        eq(employeeRampAssignments.employeeId, parsed.data.employeeId),
        eq(employeeRampAssignments.skillReferenceId, parsed.data.skillReferenceId),
      ),
    );

  invalidateCache(CACHE_TAG.ramp, CACHE_TAG.imports);

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ramp.cleared",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    before: { skillReferenceId: parsed.data.skillReferenceId },
  });

  revalidatePath("/ramp");
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { ok: true, weeksCorrected };
}
