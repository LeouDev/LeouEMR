import { redirect } from "next/navigation";
import { canRunTeamPrograms, isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import type { EwsTeam } from "@/lib/queries/ews";

/**
 * Who opens the EWS screens: supervisors, managers and administrators.
 * An agent's own record shows on their employee page (read-only), which is
 * not this — a board is for someone responsible for more than one person —
 * and a support role has no EWS at all. A hidden tab is not a permission
 * check; every screen re-checks here.
 */
export async function requireEwsUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role === "agent" || isSupportRole(user)) redirect("/dashboard");
  return user;
}

/**
 * Which team a screen shows. A supervisor's is their own, whatever the URL
 * says; a manager or administrator narrows to one of the teams in their
 * scope with `?team=`, or sees them all.
 */
export function resolveTeam(user: CurrentUser, teams: EwsTeam[], param: string | undefined): string | null {
  if (user.role === "supervisor") return user.employeeEid;
  return teams.find((t) => t.supervisorEid === param)?.supervisorEid ?? null;
}

/** Whether this viewer records: a supervisor for their own team, an administrator for any in scope. */
export function canRecord(user: CurrentUser): boolean {
  return canRunTeamPrograms(user);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
