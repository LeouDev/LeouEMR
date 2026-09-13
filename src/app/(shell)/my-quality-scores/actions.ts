"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, qaAudits } from "@/lib/db/schema";
import { NOT_AN_AGENT, NOT_LINKED, NOT_YOURS } from "@/lib/quality/messages";

export type AcknowledgeResult = { ok: true; acknowledgedAt: string } | { ok: false; error: string };

const schema = z.object({ auditId: z.string().uuid() });

/**
 * The agent marks a review as read. The only thing an agent may write
 * about an audit, and only on their own: the update is keyed on the audit
 * belonging to the employee row their account is linked to, so an id
 * guessed from elsewhere changes nothing.
 */
export async function acknowledgeAudit(input: unknown): Promise<AcknowledgeResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role !== "agent") return { ok: false, error: NOT_AN_AGENT };
  if (!user.employeeEid) return { ok: false, error: NOT_LINKED };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That audit could not be acknowledged" };

  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.eid, user.employeeEid)).limit(1);
  if (!me) return { ok: false, error: NOT_LINKED };

  const now = new Date();
  const [updated] = await db
    .update(qaAudits)
    .set({ acknowledgedAt: now, acknowledgedBy: user.id })
    .where(and(eq(qaAudits.id, parsed.data.auditId), eq(qaAudits.agentId, me.id), isNull(qaAudits.acknowledgedAt)))
    .returning({ id: qaAudits.id });
  if (!updated) return { ok: false, error: NOT_YOURS };

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "qa.audit_acknowledged",
    entityType: "qa_audit",
    entityId: updated.id,
    after: { acknowledgedAt: now.toISOString() },
  });

  revalidatePath("/my-quality-scores");
  revalidatePath("/quality/history");
  return { ok: true, acknowledgedAt: now.toISOString() };
}
