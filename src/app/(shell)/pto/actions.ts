"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, ptoRequests, users } from "@/lib/db/schema";
import { resolveScopedIds } from "@/lib/queries/performance";
import { PROBLEM_MESSAGES, canCancel, canDecide, validateRequest } from "@/lib/pto/rules";
import { canDecideForLeader } from "@/lib/pto/scope";

export type PtoResult = { ok: true } | { ok: false; error: string };

const requestSchema = z.object({
  startDate: z.string().trim().min(1),
  endDate: z.string().trim().min(1),
  type: z.enum(["vacation", "sick", "emergency", "bereavement", "unpaid"]),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * `PTO-2026-000042`, matching the action-item code style.
 *
 * Drawn from a sequence rather than a row count. Counting rows and adding one
 * is a read-then-write race against a UNIQUE column: two people submitting at
 * the same moment computed the same code, and the loser's insert raised an
 * uncaught unique violation that lost their request. A sequence hands out each
 * number exactly once however many requests arrive together.
 */
async function nextCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await db.execute<{ n: string }>(
    sql`select nextval('pto_request_code_seq')::text as n`,
  );
  return `PTO-${year}-${String(row?.n ?? "1").padStart(6, "0")}`;
}

/**
 * Files a request for the signed-in person's own employee record.
 *
 * Deliberately takes no employee id: leave is requested for yourself. A
 * supervisor filing on someone's behalf would need a different, audited
 * action rather than a parameter here that could be pointed anywhere.
 */
export async function requestPto(input: unknown): Promise<PtoResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!user.employeeEid) {
    return { ok: false, error: "Your account is not linked to an employee record yet" };
  }
  const isLeader = user.role !== "agent";

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter both a start and an end date." };

  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.eid, user.employeeEid))
    .limit(1);

  // Only agents are in the imported roster. A supervisor or manager files
  // against their own account instead, which is why employeeId is nullable.
  if (!employee && !isLeader) {
    return { ok: false, error: "No employee record matches your account" };
  }

  const existing = await db
    .select({
      startDate: ptoRequests.startDate,
      endDate: ptoRequests.endDate,
      status: ptoRequests.status,
    })
    .from(ptoRequests)
    .where(
      employee ? eq(ptoRequests.employeeId, employee.id) : eq(ptoRequests.requestedBy, user.id),
    );

  const problem = validateRequest(
    { startDate: parsed.data.startDate, endDate: parsed.data.endDate },
    existing,
  );
  if (problem) return { ok: false, error: PROBLEM_MESSAGES[problem] };

  const code = await nextCode();
  const [created] = await db
    .insert(ptoRequests)
    .values({
      code,
      employeeId: employee?.id ?? null,
      requestedBy: user.id,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      type: parsed.data.type,
      reason: parsed.data.reason || null,
    })
    .returning();

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "pto.requested",
    entityType: "pto_request",
    entityId: created.id,
    after: { code, ...parsed.data },
  });

  revalidatePath("/pto");
  return { ok: true };
}

const decisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "denied"]),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approves or denies a request.
 *
 * Two independent checks, both server-side: the caller must hold a role that
 * decides leave, and the subject must be inside that caller's own span. Role
 * alone is not enough — one supervisor must not be able to decide another
 * team's leave by posting their request id.
 */
export async function decidePto(input: unknown): Promise<PtoResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role === "agent") {
    return { ok: false, error: "Only a supervisor, manager or administrator can decide leave" };
  }

  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid decision" };

  const [request] = await db
    .select()
    .from(ptoRequests)
    .where(eq(ptoRequests.id, parsed.data.requestId))
    .limit(1);
  if (!request) return { ok: false, error: "Request not found" };

  if (!canDecide(request.status)) {
    return { ok: false, error: `This request was already ${request.status}` };
  }

  // Nobody signs off their own leave, whatever their role.
  if (request.requestedBy === user.id) {
    return { ok: false, error: "You cannot decide your own leave request" };
  }

  if (request.employeeId) {
    const scoped = await resolveScopedIds(user);
    if (!scoped.includes(request.employeeId)) {
      return { ok: false, error: "That employee is not in your team" };
    }
  } else {
    // A leader's own request. Their approver is their manager, which is read
    // off the team they supervise — a supervisor is not in the roster.
    const [requester] = request.requestedBy
      ? await db.select().from(users).where(eq(users.id, request.requestedBy)).limit(1)
      : [];
    if (!requester) return { ok: false, error: "Request has no requester" };
    if (!(await canDecideForLeader(user, requester))) {
      return { ok: false, error: "Only their manager can approve that request" };
    }
  }

  await db
    .update(ptoRequests)
    .set({
      status: parsed.data.decision,
      decidedBy: user.id,
      decidedAt: new Date(),
      decisionNote: parsed.data.note || null,
      updatedAt: new Date(),
    })
    .where(and(eq(ptoRequests.id, request.id), eq(ptoRequests.status, "pending")));

  await db.insert(auditLog).values({
    actorId: user.id,
    action: `pto.${parsed.data.decision}`,
    entityType: "pto_request",
    entityId: request.id,
    before: { status: request.status },
    after: { status: parsed.data.decision, note: parsed.data.note ?? null },
  });

  revalidatePath("/pto");
  return { ok: true };
}

/** Withdraws your own request. Leaders cancel by denying, which is recorded. */
export async function cancelPto(requestId: string): Promise<PtoResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const [request] = await db
    .select()
    .from(ptoRequests)
    .where(eq(ptoRequests.id, requestId))
    .limit(1);
  if (!request) return { ok: false, error: "Request not found" };
  if (request.requestedBy !== user.id) {
    return { ok: false, error: "You can only withdraw your own request" };
  }
  if (!canCancel(request.status)) {
    return { ok: false, error: `This request was already ${request.status}` };
  }

  await db
    .update(ptoRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(ptoRequests.id, request.id));

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "pto.cancelled",
    entityType: "pto_request",
    entityId: request.id,
    before: { status: request.status },
    after: { status: "cancelled" },
  });

  revalidatePath("/pto");
  return { ok: true };
}
