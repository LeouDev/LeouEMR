"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { canAcknowledge, canManageActionItems, employeeScope } from "@/lib/auth/scope";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  acknowledgements,
  actionItems,
  actionPlans,
  auditLog,
  employees,
  notifications,
  performanceIssues,
  rcaEntries,
  users,
} from "@/lib/db/schema";
import {
  acknowledgeByAgent,
  submitRcaAndActionPlan,
} from "@/lib/action-item-engine/engine";
import { actionPlanSchema, rcaSchema } from "@/lib/rca-action-plan/validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Loads an action item only if the caller's role scope covers its employee.
 * Every mutation goes through this, so changing the id in a request cannot
 * reach another team's data (spec section 28).
 */
async function loadScopedItem(user: CurrentUser, actionItemId: string) {
  const scope = employeeScope(user);
  if (scope === null) return null;

  const [row] = await db
    .select({
      actionItem: actionItems,
      issue: performanceIssues,
      employee: employees,
    })
    .from(actionItems)
    .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
    .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
    .where(and(eq(actionItems.id, actionItemId), scope === "all" ? undefined : scope))
    .limit(1);

  return row ?? null;
}

export async function saveRca(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can enter an RCA" };
  }

  const parsed = rcaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid RCA" };
  }

  const scoped = await loadScopedItem(user, parsed.data.actionItemId);
  if (!scoped) return { ok: false, error: "Action item not found" };

  const values = {
    actionItemId: parsed.data.actionItemId,
    problemStatement: parsed.data.problemStatement,
    rootCauseCategoryId: parsed.data.rootCauseCategoryId,
    rootCauseDetails: parsed.data.rootCauseDetails,
    contributingFactors: parsed.data.contributingFactors || null,
    evidenceNotes: parsed.data.evidenceNotes || null,
  };

  const [existing] = await db
    .select()
    .from(rcaEntries)
    .where(eq(rcaEntries.actionItemId, parsed.data.actionItemId))
    .limit(1);

  if (existing) {
    await db
      .update(rcaEntries)
      .set({ ...values, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(rcaEntries.id, existing.id));
  } else {
    await db.insert(rcaEntries).values({ ...values, createdBy: user.id });
  }

  await db.insert(auditLog).values({
    actorId: user.id,
    action: existing ? "rca.updated" : "rca.created",
    entityType: "action_item",
    entityId: parsed.data.actionItemId,
    after: { rootCauseCategoryId: parsed.data.rootCauseCategoryId },
  });

  revalidatePath(`/action-items/${parsed.data.actionItemId}`);
  return { ok: true };
}

export async function saveActionPlan(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can enter an action plan" };
  }

  const parsed = actionPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid action plan" };
  }

  const scoped = await loadScopedItem(user, parsed.data.actionItemId);
  if (!scoped) return { ok: false, error: "Action item not found" };

  const values = {
    actionItemId: parsed.data.actionItemId,
    correctiveAction: parsed.data.correctiveAction,
    expectedBehavior: parsed.data.expectedBehavior,
    targetMetric: parsed.data.targetMetric,
    targetValue: parsed.data.targetValue,
    dueDate: parsed.data.dueDate,
    followUpDate: parsed.data.followUpDate,
    coachingRequired: parsed.data.coachingRequired,
    trainingRequired: parsed.data.trainingRequired,
    supervisorNotes: parsed.data.supervisorNotes || null,
  };

  const [existing] = await db
    .select()
    .from(actionPlans)
    .where(eq(actionPlans.actionItemId, parsed.data.actionItemId))
    .limit(1);

  if (existing) {
    await db
      .update(actionPlans)
      .set({ ...values, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(actionPlans.id, existing.id));
  } else {
    await db.insert(actionPlans).values({ ...values, createdBy: user.id });
  }

  await db.insert(auditLog).values({
    actorId: user.id,
    action: existing ? "action_plan.updated" : "action_plan.created",
    entityType: "action_item",
    entityId: parsed.data.actionItemId,
    after: { dueDate: parsed.data.dueDate },
  });

  await db
    .update(actionItems)
    .set({ dueDate: parsed.data.dueDate, followUpDate: parsed.data.followUpDate, updatedAt: new Date() })
    .where(eq(actionItems.id, parsed.data.actionItemId));

  revalidatePath(`/action-items/${parsed.data.actionItemId}`);
  return { ok: true };
}

/**
 * Sends the item to the agent. Refuses unless both the RCA and the action
 * plan exist — the gate from spec section 8, enforced server-side.
 */
export async function sendToAgent(actionItemId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canManageActionItems(user)) {
    return { ok: false, error: "Only supervisors and administrators can send an action item" };
  }

  const scoped = await loadScopedItem(user, actionItemId);
  if (!scoped) return { ok: false, error: "Action item not found" };

  const [rca] = await db.select().from(rcaEntries).where(eq(rcaEntries.actionItemId, actionItemId)).limit(1);
  const [plan] = await db.select().from(actionPlans).where(eq(actionPlans.actionItemId, actionItemId)).limit(1);

  if (!rca) return { ok: false, error: "Enter the RCA before sending to the agent" };
  if (!plan) return { ok: false, error: "Enter the action plan before sending to the agent" };

  let next;
  try {
    next = submitRcaAndActionPlan(
      {
        status: scoped.issue.status,
        consecutivePassingWeeks: scoped.issue.consecutivePassingWeeks,
        openedWeek: scoped.issue.openedWeek,
      },
      scoped.issue.openedWeek,
    );
  } catch {
    return { ok: false, error: `Cannot send an item that is ${scoped.issue.status}` };
  }

  await setIssueStatus(scoped.issue.id, actionItemId, next.issue.status);

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "action_item.sent_to_agent",
    entityType: "action_item",
    entityId: actionItemId,
    after: { status: next.issue.status },
  });

  await notifyAgent(scoped.employee.eid, {
    type: "action_item.awaiting_acknowledgement",
    actionItemId,
    employeeName: scoped.employee.name,
  });

  revalidatePath(`/action-items/${actionItemId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** The agent acknowledges their own item. Nobody may acknowledge on their behalf. */
export async function acknowledge(actionItemId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canAcknowledge(user)) {
    return { ok: false, error: "Only the agent named on an action item can acknowledge it" };
  }

  const scoped = await loadScopedItem(user, actionItemId);
  if (!scoped) return { ok: false, error: "Action item not found" };
  if (!user.employeeEid || scoped.employee.eid !== user.employeeEid) {
    return { ok: false, error: "You can only acknowledge your own action items" };
  }

  let next;
  try {
    next = acknowledgeByAgent(
      {
        status: scoped.issue.status,
        consecutivePassingWeeks: scoped.issue.consecutivePassingWeeks,
        openedWeek: scoped.issue.openedWeek,
      },
      scoped.issue.openedWeek,
    );
  } catch {
    return { ok: false, error: "This action item is not awaiting your acknowledgement" };
  }

  await db.insert(acknowledgements).values({ actionItemId, agentId: user.id });
  await setIssueStatus(scoped.issue.id, actionItemId, next.issue.status);

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "action_item.acknowledged",
    entityType: "action_item",
    entityId: actionItemId,
    after: { status: next.issue.status },
  });

  // Notify whoever supervises this employee.
  const supervisorIds = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "supervisor"),
        scoped.employee.supervisorEid ? eq(users.employeeEid, scoped.employee.supervisorEid) : undefined,
      ),
    );

  if (supervisorIds.length > 0) {
    await db.insert(notifications).values(
      supervisorIds.map((s) => ({
        recipientId: s.id,
        type: "action_item.acknowledged",
        payload: { actionItemId, employeeName: scoped.employee.name },
      })),
    );
  }

  revalidatePath(`/action-items/${actionItemId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

async function setIssueStatus(issueId: string, actionItemId: string, status: typeof performanceIssues.$inferSelect.status) {
  await db
    .update(performanceIssues)
    .set({ status, updatedAt: new Date() })
    .where(eq(performanceIssues.id, issueId));
  await db
    .update(actionItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(actionItems.id, actionItemId));
}

async function notifyAgent(
  employeeEid: string,
  payload: { type: string; actionItemId: string; employeeName: string },
) {
  const agents = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "agent"), inArray(users.employeeEid, [employeeEid])));

  if (agents.length === 0) return;

  await db.insert(notifications).values(
    agents.map((agent) => ({
      recipientId: agent.id,
      type: payload.type,
      payload: { actionItemId: payload.actionItemId },
    })),
  );
}
