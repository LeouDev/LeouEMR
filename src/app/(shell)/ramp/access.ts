import { redirect } from "next/navigation";
import { employeeScope, isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

/**
 * The signed-in leader every ramp page renders for; anyone else is sent on.
 *
 * A hidden tab is not a permission check: this is a leader tool with
 * nothing in it for an agent to see about themselves or anyone else, so
 * each page asks rather than trusting the navigation not to show it.
 */
export async function requireRampUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role === "agent" || isSupportRole(user)) redirect("/dashboard");
  return user;
}

/**
 * The team names this person may see, by the same scope rule every other
 * roster uses — a supervisor their own team, a manager their span, an
 * administrator everyone.
 *
 * "Unassigned" stands for an employee with no supervisor recorded, matching
 * how the progression groups them.
 */
export async function visibleTeamNames(user: CurrentUser): Promise<Set<string>> {
  const scope = employeeScope(user);
  if (scope === null) return new Set();

  const mine = await db
    .select({ supervisor: employees.supervisorName })
    .from(employees)
    .where(scope === "all" ? undefined : scope);

  return new Set(mine.map((row) => row.supervisor ?? "Unassigned"));
}

/** Today as YYYY-MM-DD, so the board reflects "right now" rather than a filtered period. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
