"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAssessment, type EwsResult } from "@/lib/ews/save";

export type { EwsResult };

const schema = z.object({
  employeeId: z.string().uuid(),
  week: z.string().min(1),
  indicators: z.record(z.string(), z.boolean()),
  capActive: z.boolean(),
  attrition: z.enum(["none", "black", "absconding", "loa", "maternity"]),
  attritionDate: z.string().optional().or(z.literal("")),
  expectedReturn: z.string().optional().or(z.literal("")),
  actionPlan: z.enum(["MONITORING", "SKIP_LEVEL", "ADMIN_HEARING", "OTHER"]).nullable().optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Records a supervisor's weekly EWS assessment, from the employee page's
 * panel or the EWS tracker's form. The scoring, the status write and the
 * separation hook live in src/lib/ews/save.ts.
 */
export async function saveEwsAssessment(input: unknown): Promise<EwsResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assessment" };
  }

  const result = await writeAssessment(user, {
    employeeId: parsed.data.employeeId,
    week: parsed.data.week,
    indicators: parsed.data.indicators,
    capActive: parsed.data.capActive,
    attrition: parsed.data.attrition,
    attritionDate: parsed.data.attritionDate || null,
    expectedReturn: parsed.data.expectedReturn || null,
    actionPlan: parsed.data.actionPlan ?? null,
    notes: parsed.data.notes || null,
  });

  if (result.ok) {
    revalidatePath(`/employees/${parsed.data.employeeId}`);
    revalidatePath("/ews");
    revalidatePath("/ews/attrition");
  }
  return result;
}
