"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canRunTeamPrograms } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, ewsAssessments, ewsHeadcount } from "@/lib/db/schema";
import type { EwsActionPlan } from "@/lib/ews/engine";
import { writeAssessment, type EwsResult } from "@/lib/ews/save";
import { ewsAssessmentWeek, getEwsTeams } from "@/lib/queries/ews";

const count = z.coerce.number().int().min(0).max(100000);

const headcountSchema = z.object({
  supervisorEid: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  /** Blank carries the previous month's closing forward. */
  openingOverride: z.union([z.literal(""), z.null(), count]),
  newHires: count,
  transferIn: count,
  transferOut: count,
  voluntaryAttrition: count,
  involuntaryAttrition: count,
});

export type HeadcountResult = { ok: true } | { ok: false; error: string };

/**
 * Whether this user records for this team: a supervisor for their own, an
 * administrator for any team in scope. A manager reads.
 */
async function canRecordFor(user: Awaited<ReturnType<typeof getCurrentUser>>, supervisorEid: string): Promise<boolean> {
  if (!user || user.status !== "active" || !canRunTeamPrograms(user)) return false;
  if (user.role === "supervisor") return user.employeeEid === supervisorEid;
  const teams = await getEwsTeams(user);
  return teams.some((t) => t.supervisorEid === supervisorEid);
}

/** Records a month of a team's headcount movement; one row per team per month, replaced in place. */
export async function saveHeadcountMonth(input: unknown): Promise<HeadcountResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = headcountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid month" };
  const d = parsed.data;

  if (!(await canRecordFor(user, d.supervisorEid))) {
    return { ok: false, error: "Only the team's leader or an administrator can record headcount" };
  }

  const values = {
    openingOverride: d.openingOverride === "" || d.openingOverride === null ? null : d.openingOverride,
    newHires: d.newHires,
    transferIn: d.transferIn,
    transferOut: d.transferOut,
    voluntaryAttrition: d.voluntaryAttrition,
    involuntaryAttrition: d.involuntaryAttrition,
    updatedBy: user.id,
    updatedAt: new Date(),
  };

  await db
    .insert(ewsHeadcount)
    .values({ supervisorEid: d.supervisorEid, year: d.year, month: d.month, ...values })
    .onConflictDoUpdate({
      target: [ewsHeadcount.supervisorEid, ewsHeadcount.year, ewsHeadcount.month],
      set: values,
    });

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ews.headcount_recorded",
    entityType: "team",
    after: { supervisorEid: d.supervisorEid, year: d.year, month: d.month, ...values, updatedAt: undefined },
  });

  revalidatePath("/ews/headcount");
  return { ok: true };
}

/**
 * Takes someone off the permanent attrition list: their latest record is
 * re-saved for the current data week with the tag cleared and everything
 * else as it was, so the employee returns to active through the same path
 * a supervisor's own edit would take.
 */
export async function restoreFromAttrition(input: unknown): Promise<EwsResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = z.object({ employeeId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid employee" };

  const [latest] = await db
    .select({
      indicators: ewsAssessments.indicators,
      capActive: ewsAssessments.capActive,
      attrition: ewsAssessments.attrition,
      actionPlan: ewsAssessments.actionPlan,
      notes: ewsAssessments.notes,
    })
    .from(ewsAssessments)
    .where(eq(ewsAssessments.employeeId, parsed.data.employeeId))
    .orderBy(desc(ewsAssessments.week))
    .limit(1);
  if (!latest || latest.attrition !== "black") return { ok: false, error: "Not on the attrition list" };

  const result = await writeAssessment(user, {
    employeeId: parsed.data.employeeId,
    week: await ewsAssessmentWeek(new Date().toISOString().slice(0, 10)),
    indicators: (latest.indicators as Record<string, boolean>) ?? {},
    capActive: latest.capActive,
    attrition: "none",
    attritionDate: null,
    expectedReturn: null,
    actionPlan: (latest.actionPlan as EwsActionPlan | null) ?? null,
    notes: latest.notes,
  });

  if (result.ok) {
    revalidatePath("/ews");
    revalidatePath("/ews/attrition");
    revalidatePath(`/employees/${parsed.data.employeeId}`);
  }
  return result;
}
