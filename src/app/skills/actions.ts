"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, skillReferences } from "@/lib/db/schema";

const updateTargetSchema = z.object({
  skillId: z.string().uuid(),
  target: z.number().positive().finite(),
});

export type UpdateTargetResult = { ok: true; target: number } | { ok: false; error: string };

/**
 * Updates a skill's target. Only the target is mutable — the R1-R5 rating
 * thresholds are fixed scoring policy and are never writable from the UI.
 *
 * Authorization is enforced here, server-side, from the session — the
 * client's claim about who it is never enters into it (spec section 28).
 */
export async function updateSkillTarget(input: {
  skillId: string;
  target: number;
}): Promise<UpdateTargetResult> {
  const user = await getCurrentUser();

  if (!user || user.status !== "active") {
    return { ok: false, error: "Not signed in" };
  }
  if (user.role !== "admin") {
    return { ok: false, error: "Only administrators can change skill targets" };
  }

  const parsed = updateTargetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Target must be a positive number" };
  }

  const [before] = await db
    .select()
    .from(skillReferences)
    .where(eq(skillReferences.id, parsed.data.skillId))
    .limit(1);

  if (!before) return { ok: false, error: "Skill not found" };

  const [after] = await db
    .update(skillReferences)
    .set({ target: parsed.data.target, updatedAt: new Date() })
    .where(eq(skillReferences.id, parsed.data.skillId))
    .returning();

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "skill_target.updated",
    entityType: "skill_reference",
    entityId: before.id,
    before: { target: before.target },
    after: { target: after.target },
  });

  revalidatePath("/skills");
  return { ok: true, target: after.target };
}
