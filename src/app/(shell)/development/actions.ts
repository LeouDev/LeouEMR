"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { getEmployeeMatrix, type EmployeeMatrix } from "@/lib/queries/performance";
import { getEmployeeSkillBreakdown, type SkillBreakdownRow } from "@/lib/queries/skill-breakdown";

export type AgentDetail = { matrix: EmployeeMatrix; skills: SkillBreakdownRow[] } | null;

/**
 * One agent's KPI matrix and skill breakdown, fetched when their row on the
 * roster is opened rather than with the roster itself.
 *
 * The flat board it replaces was already the second-largest response in the
 * app at 59 kB — every item of every person in development, rendered into a
 * box that showed twenty rows. A roster that also carried each agent's
 * week-by-week KPI grid and skill table up front would be several times
 * that, for detail nobody has asked to see yet. So the tree arrives as
 * names and counts, and the expensive part is fetched one agent at a time,
 * on the click that asks for it.
 *
 * Authorised by `getEmployeeMatrix`, which resolves the caller's own scope
 * and returns null for an employee outside it. That check is what makes the
 * employee id in the argument safe: it is a request, not a grant. The skill
 * breakdown takes no user of its own, so it is only ever reached through
 * that null check having passed.
 */
export async function loadAgentDetail(employeeId: string): Promise<AgentDetail> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return null;

  const matrix = await getEmployeeMatrix(user, employeeId);
  if (!matrix) return null;

  const skills = await getEmployeeSkillBreakdown(employeeId, matrix.employee.eid, matrix.weeks);
  return { matrix, skills };
}
