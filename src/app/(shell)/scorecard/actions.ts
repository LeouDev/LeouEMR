"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withScope } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, notifications, scorecardReviews, users } from "@/lib/db/schema";
import { periodContaining } from "@/lib/queries/period";
import { computeScorecards } from "@/lib/scorecard/load";
import { canReview, reviewOpensOn } from "@/lib/scorecard/review";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Module-private: a "use server" file may export only async functions.
const NOT_A_TEAM_LEADER = "Only the team leader reviews a scorecard";
const NOT_AN_AGENT = "Only the agent named on a scorecard acknowledges it";

const monthSchema = z.string().regex(/^\d{4}-\d{2}-01$/, "Pick the month");

const reviewSchema = z.object({ employeeId: z.string().uuid(), month: monthSchema });
const acknowledgeSchema = z.object({ month: monthSchema });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function opensOnLabel(monthStart: string): string {
  return new Date(`${reviewOpensOn(monthStart)}T00:00:00Z`).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

/**
 * The team leader signs off a month's card. Locked until ten days after
 * the month ends so the month's data can land first; a re-review after a
 * re-import moved the card clears the agent's acknowledgement, since what
 * they acknowledged is no longer what the card says. The score at review
 * is stored so the page can tell when that has happened.
 */
export async function reviewScorecard(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role !== "supervisor") return { ok: false, error: NOT_A_TEAM_LEADER };

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { employeeId, month } = parsed.data;

  if (!canReview(month, todayIso())) {
    return {
      ok: false,
      error: `The ${periodContaining("month", month).label} scorecard opens for review on ${opensOnLabel(month)}`,
    };
  }

  // Role alone is not enough — the person must be on this leader's team.
  const scope = withScope(user, eq(employees.id, employeeId));
  if (scope === null) return { ok: false, error: "Employee not found" };
  const [employee] = await db
    .select({ id: employees.id, eid: employees.eid, name: employees.name })
    .from(employees)
    .where(scope)
    .limit(1);
  if (!employee) return { ok: false, error: "Employee not found" };

  const card = (await computeScorecards([employee.id], month)).get(employee.id);
  const reviewedScore = card?.finalScore ?? null;
  const now = new Date();

  await db
    .insert(scorecardReviews)
    .values({ employeeId: employee.id, month, reviewedBy: user.id, reviewedAt: now, reviewedScore })
    .onConflictDoUpdate({
      target: [scorecardReviews.employeeId, scorecardReviews.month],
      set: {
        reviewedBy: user.id,
        reviewedAt: now,
        reviewedScore,
        acknowledgedBy: null,
        acknowledgedAt: null,
        updatedAt: sql`now()`,
      },
    });

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "scorecard.reviewed",
    entityType: "employee",
    entityId: employee.id,
    after: { month, reviewedScore },
  });

  const agents = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "agent"), inArray(users.employeeEid, [employee.eid])));
  if (agents.length > 0) {
    await db.insert(notifications).values(
      agents.map((agent) => ({
        recipientId: agent.id,
        type: "scorecard.reviewed",
        payload: { month },
      })),
    );
  }

  revalidatePath("/scorecard");
  return { ok: true };
}

/**
 * The agent acknowledges their own reviewed card. Nobody acknowledges on
 * their behalf, and nothing can be acknowledged before the team leader
 * has reviewed it.
 */
export async function acknowledgeScorecard(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role !== "agent") return { ok: false, error: NOT_AN_AGENT };
  if (!user.employeeEid) return { ok: false, error: "Your account is not linked to an employee record" };

  const parsed = acknowledgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { month } = parsed.data;

  const [me] = await db
    .select({ id: employees.id, name: employees.name, supervisorEid: employees.supervisorEid })
    .from(employees)
    .where(eq(employees.eid, user.employeeEid))
    .limit(1);
  if (!me) return { ok: false, error: "Your account is not linked to an employee record" };

  const [review] = await db
    .select({ id: scorecardReviews.id, acknowledgedAt: scorecardReviews.acknowledgedAt })
    .from(scorecardReviews)
    .where(and(eq(scorecardReviews.employeeId, me.id), eq(scorecardReviews.month, month)))
    .limit(1);
  if (!review) return { ok: false, error: "Your team leader has not reviewed this month's scorecard yet" };
  if (review.acknowledgedAt) return { ok: false, error: "This scorecard is already acknowledged" };

  const now = new Date();
  await db
    .update(scorecardReviews)
    .set({ acknowledgedBy: user.id, acknowledgedAt: now, updatedAt: sql`now()` })
    .where(eq(scorecardReviews.id, review.id));

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "scorecard.acknowledged",
    entityType: "employee",
    entityId: me.id,
    after: { month, acknowledgedAt: now.toISOString() },
  });

  if (me.supervisorEid) {
    const leaders = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "supervisor"), eq(users.employeeEid, me.supervisorEid)));
    if (leaders.length > 0) {
      await db.insert(notifications).values(
        leaders.map((leader) => ({
          recipientId: leader.id,
          type: "scorecard.acknowledged",
          payload: { month, employeeId: me.id, employeeName: me.name },
        })),
      );
    }
  }

  revalidatePath("/scorecard");
  return { ok: true };
}
