import { and, desc, eq } from "drizzle-orm";
import { canRunTeamPrograms, employeeScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { CACHE_TAG, invalidateCache } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { auditLog, employees, ewsAssessments } from "@/lib/db/schema";
import { closeIssuesOnSeparation } from "@/lib/action-item-engine/persistence";
import { periodContaining } from "@/lib/queries/period";
import { autoIndicatorsFor } from "@/lib/queries/ews";
import { autoFlags } from "./auto-indicators";
import { computeEwsRisk, employeeStatusFor, expectsReturn, type EwsActionPlan, type EwsAttrition } from "./engine";
import { manualFlags } from "./roster";

/**
 * The one write path for an assessment, behind both the employee page's
 * panel and the EWS tracker's form. Not a server action itself: a "use
 * server" module exposes every export as an endpoint, and the tracker's
 * restore needs to call this with values it read, not values a browser
 * sent.
 */

export interface AssessmentWrite {
  employeeId: string;
  week: string;
  /** The supervisor's ticks. Derived codes in here are ignored; the data answers those. */
  indicators: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
  attritionDate: string | null;
  expectedReturn: string | null;
  actionPlan: EwsActionPlan | null;
  notes: string | null;
}

export type EwsResult = { ok: true; riskLevel: string; score: number } | { ok: false; error: string };

export async function writeAssessment(user: CurrentUser, input: AssessmentWrite): Promise<EwsResult> {
  if (!canRunTeamPrograms(user)) {
    return { ok: false, error: "Only supervisors and administrators can record an assessment" };
  }

  // Confirm the employee is inside the caller's scope before writing.
  const scope = employeeScope(user);
  if (scope === null) return { ok: false, error: "No employees in scope" };

  const [employee] = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), scope === "all" ? undefined : scope))
    .limit(1);

  if (!employee) return { ok: false, error: "Employee not found" };

  // The risk level is computed server-side from the submitted flags rather
  // than accepted from the client, so a crafted request cannot post a GREEN
  // badge alongside four flagged indicators — and the three data-derived
  // flags are read from the week's figures here, never from the request.
  const auto = await autoIndicatorsFor([input.employeeId], periodContaining("week", input.week));
  const indicators = { ...manualFlags(input.indicators), ...autoFlags(auto.get(input.employeeId)!) };
  const attritionDate = input.attrition === "none" ? null : input.attritionDate || null;
  const expectedReturn = expectsReturn(input.attrition) ? input.expectedReturn || null : null;

  const { score, riskLevel } = computeEwsRisk({ indicators, capActive: input.capActive, attrition: input.attrition });

  const values = {
    indicators,
    capActive: input.capActive,
    attrition: input.attrition,
    attritionDate,
    expectedReturn,
    actionPlan: input.actionPlan,
    notes: input.notes || null,
    score,
    riskLevel,
    assessedBy: user.id,
  };

  await db
    .insert(ewsAssessments)
    .values({ employeeId: input.employeeId, week: input.week, ...values })
    .onConflictDoUpdate({
      target: [ewsAssessments.employeeId, ewsAssessments.week],
      set: { ...values, updatedAt: new Date() },
    });

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ews.assessed",
    entityType: "employee",
    entityId: input.employeeId,
    after: { week: input.week, score, riskLevel, attrition: input.attrition },
  });

  // Employment status follows the LATEST assessment, not the one just saved.
  // A supervisor correcting a week from two months ago must not resurrect an
  // attrition tag that has since been cleared, or clear one still standing.
  const [latest] = await db
    .select({
      attrition: ewsAssessments.attrition,
      attritionDate: ewsAssessments.attritionDate,
      week: ewsAssessments.week,
    })
    .from(ewsAssessments)
    .where(eq(ewsAssessments.employeeId, input.employeeId))
    .orderBy(desc(ewsAssessments.week))
    .limit(1);

  const nextStatus = employeeStatusFor(latest?.attrition ?? "none");
  const [current] = await db
    .select({ status: employees.status })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .limit(1);

  if (current && current.status !== nextStatus) {
    await db
      .update(employees)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(employees.id, input.employeeId));

    await db.insert(auditLog).values({
      actorId: user.id,
      action: "employee.status_changed",
      entityType: "employee",
      entityId: input.employeeId,
      before: { status: current.status },
      after: { status: nextStatus, from: latest?.attrition ?? "none", week: latest?.week ?? null },
    });
  }

  // Someone who has left should not carry open work. Leave states keep
  // theirs — they come back to it. Closed whether or not the status changed
  // just now: a masterlist may have marked them separated first, or the tag
  // is being re-saved, and either way nothing of theirs should stay open.
  // Resolved as of the week they left, the same week every list uses.
  if (nextStatus === "separated") {
    const left = latest?.attritionDate ?? latest?.week ?? input.week;
    await closeIssuesOnSeparation(input.employeeId, periodContaining("week", left).start);
  }

  // An assessment can carry a separation date, which decides who counts in
  // every cached period figure — and a separation closes their open work.
  invalidateCache(CACHE_TAG.ews, CACHE_TAG.issues);
  return { ok: true, riskLevel, score };
}
