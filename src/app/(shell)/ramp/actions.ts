"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canRunTeamPrograms, employeeScope, isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { CACHE_TAG, invalidateCache } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { auditLog, employeeRampAssignments, employees } from "@/lib/db/schema";
import { periodContaining } from "@/lib/queries/period";
import {
  getRampProgression,
  getStageDetail,
  loadTeamAgents,
  type AgentProgression,
  type StageDetail,
} from "@/lib/queries/ramp-progression";
import { visibleTeamNames } from "./access";
import { LAST_STAGE } from "@/lib/ramp/engine";
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
  if (!canRunTeamPrograms(user)) {
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
  revalidatePath("/ramp/progression");
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
  if (!canRunTeamPrograms(user)) {
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
  revalidatePath("/ramp/progression");
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { ok: true, weeksCorrected };
}

export type ReapplyAllResult = { ok: true; assignments: number; weeksCorrected: number } | { ok: false; error: string };

/**
 * Re-runs every ramp assignment in the caller's scope against the current
 * schedule, correcting the stored weekly targets and the action items
 * derived from them — the same replay "Start ramp" does for one person.
 * For when the schedule itself changes (a stage added, a target edited in
 * the database) and every ramping agent's already-imported weeks need to
 * follow it, without re-saving each assignment by hand.
 */
export async function reapplyAllRamps(): Promise<ReapplyAllResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canRunTeamPrograms(user)) {
    return { ok: false, error: "Only supervisors and administrators can re-apply ramp schedules" };
  }
  const scope = employeeScope(user);
  if (scope === null) return { ok: false, error: "Nobody is in your scope" };

  const assignments = await db
    .select({
      employeeId: employeeRampAssignments.employeeId,
      skillReferenceId: employeeRampAssignments.skillReferenceId,
      rampStartWeek: employeeRampAssignments.rampStartWeek,
    })
    .from(employeeRampAssignments)
    .innerJoin(employees, eq(employees.id, employeeRampAssignments.employeeId))
    .where(scope === "all" ? undefined : scope);

  // One at a time: each replay re-runs the issue engine for the weeks it
  // touched, and those runs must not interleave.
  let weeksCorrected = 0;
  for (const a of assignments) {
    const result = await reapplyRampToStoredWeeks(a.employeeId, a.skillReferenceId, a.rampStartWeek);
    weeksCorrected += result.weeksCorrected;
  }

  invalidateCache(CACHE_TAG.ramp, CACHE_TAG.imports);

  await db.insert(auditLog).values({
    actorId: user.id,
    action: "ramp.reapplied_all",
    entityType: "employee",
    entityId: user.id,
    after: { assignments: assignments.length, weeksCorrected },
  });

  revalidatePath("/ramp");
  revalidatePath("/ramp/progression");
  return { ok: true, assignments: assignments.length, weeksCorrected };
}

export type TeamAgentsResult = { ok: true; agents: AgentProgression[] } | { ok: false; error: string };
export type StageDetailResult = { ok: true; detail: StageDetail } | { ok: false; error: string };

/**
 * One team's agents, fetched when the team is opened rather than with the
 * page — the reason only the team level is cached (see ramp-progression.ts).
 *
 * Authorised against the caller's own scope by name: a supervisor may open
 * their own team and nobody else's, and a team name in the argument is a
 * request rather than a grant.
 */
export async function loadRampTeamAgents(supervisor: unknown): Promise<TeamAgentsResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role === "agent" || isSupportRole(user)) return { ok: false, error: "Not allowed" };

  const name = z.string().min(1).safeParse(supervisor);
  if (!name.success) return { ok: false, error: "Unknown team" };

  const visible = await visibleTeams(user);
  if (!visible.has(name.data)) return { ok: false, error: "Unknown team" };

  return { ok: true, agents: await loadTeamAgents(name.data) };
}

/**
 * What the supervisor wrote about one agent during one stage, for the side
 * panel. Scoped the same way, through the team the agent belongs to.
 */
export async function loadRampStageDetail(input: unknown): Promise<StageDetailResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role === "agent" || isSupportRole(user)) return { ok: false, error: "Not allowed" };

  const parsed = z
    .object({ employeeId: z.string().uuid(), stage: z.number().int().min(0).max(LAST_STAGE) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown agent or stage" };

  const scoped = await loadScopedEmployee(user, parsed.data.employeeId);
  if (!scoped) return { ok: false, error: "Unknown agent or stage" };

  return { ok: true, detail: await getStageDetail(parsed.data.employeeId, parsed.data.stage) };
}

/**
 * The team names this caller may open — the progression's own teams,
 * narrowed by the same scope rule the page renders with, so a team name in
 * the argument is a request rather than a grant.
 */
async function visibleTeams(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>): Promise<Set<string>> {
  const [teams, allowed] = await Promise.all([getRampProgression(), visibleTeamNames(user)]);
  return new Set(teams.map((t) => t.supervisor).filter((name) => allowed.has(name)));
}
