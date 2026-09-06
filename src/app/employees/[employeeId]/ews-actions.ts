"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageActionItems, employeeScope } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, ewsAssessments } from "@/lib/db/schema";
import { computeEwsRisk } from "@/lib/ews/engine";

const schema = z.object({
  employeeId: z.string().uuid(),
  week: z.string().min(1),
  indicators: z.record(z.string(), z.boolean()),
  capActive: z.boolean(),
  attrition: z.enum(["none", "black", "absconding", "loa", "maternity"]),
  attritionDate: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type EwsResult = { ok: true; riskLevel: string; score: number } | { ok: false; error: string };

/**
 * Records a supervisor's weekly EWS assessment.
 *
 * The risk level is computed server-side from the submitted flags rather
 * than accepted from the client, so a crafted request cannot post a GREEN
 * badge alongside four flagged indicators.
 */
export async function saveEwsAssessment(input: unknown): Promise<EwsResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can record an assessment" };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assessment" };
  }

  // Confirm the employee is inside the caller's scope before writing.
  const scope = employeeScope(user);
  if (scope === null) return { ok: false, error: "No employees in scope" };

  const [employee] = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(
      and(eq(employees.id, parsed.data.employeeId), scope === "all" ? undefined : scope),
    )
    .limit(1);

  if (!employee) return { ok: false, error: "Employee not found" };

  const { score, riskLevel } = computeEwsRisk({
    indicators: parsed.data.indicators,
    capActive: parsed.data.capActive,
    attrition: parsed.data.attrition,
  });

  await db
    .insert(ewsAssessments)
    .values({
      employeeId: parsed.data.employeeId,
      week: parsed.data.week,
      indicators: parsed.data.indicators,
      capActive: parsed.data.capActive,
      attrition: parsed.data.attrition,
      attritionDate: parsed.data.attritionDate || null,
      notes: parsed.data.notes || null,
      score,
      riskLevel,
      assessedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [ewsAssessments.employeeId, ewsAssessments.week],
      set: {
        indicators: parsed.data.indicators,
        capActive: parsed.data.capActive,
        attrition: parsed.data.attrition,
        attritionDate: parsed.data.attritionDate || null,
        notes: parsed.data.notes || null,
        score,
        riskLevel,
        assessedBy: user.id,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ews.assessed",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    after: { week: parsed.data.week, score, riskLevel },
  });

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { ok: true, riskLevel, score };
}
