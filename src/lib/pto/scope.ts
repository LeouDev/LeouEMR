import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employees, users } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { resolveScopedIds } from "@/lib/queries/performance";

/**
 * Who a viewer can see leave for.
 *
 * Deliberately wider than the performance scope for agents alone. An agent
 * may see nobody's *performance* but their own, yet a leave calendar only
 * works if you can see your own team's — knowing who is out is how people
 * arrange cover. Everyone else keeps exactly their performance scope:
 *
 *   admin       every employee
 *   manager     their span
 *   supervisor  their direct reports
 *   agent       their team, meaning everyone under the same supervisor
 *
 * An agent whose record carries no supervisor falls back to just themselves,
 * which fails closed rather than exposing an unrelated group.
 */
export async function ptoScopeIds(user: CurrentUser): Promise<string[]> {
  if (user.role !== "agent") return resolveScopedIds(user);
  if (!user.employeeEid) return [];

  const [self] = await db
    .select({ id: employees.id, supervisorEid: employees.supervisorEid })
    .from(employees)
    .where(eq(employees.eid, user.employeeEid))
    .limit(1);

  if (!self) return [];
  if (!self.supervisorEid) return [self.id];

  const team = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.supervisorEid, self.supervisorEid));

  return team.map((t) => t.id);
}

/**
 * Whether the viewer may see why someone is away.
 *
 * Leave type is health-adjacent — "sick" and "bereavement" say something
 * personal — so peers see only that a colleague is out. The people who
 * approve leave need the type to do it, and already see the reason text.
 */
export function canSeeLeaveType(user: CurrentUser): boolean {
  return user.role !== "agent";
}

/**
 * The manager name responsible for a leader who has no employee row.
 *
 * The imported workbook contains only agents, so a supervisor exists in the
 * data solely as a name on their reports' rows. Their manager is therefore
 * whoever manages those reports — read off the team rather than stored, since
 * nothing in the source states it directly.
 *
 * Returns null when the person has no reports, which fails closed: nobody can
 * approve their leave until an administrator links them properly.
 */
export async function managerNameFor(user: CurrentUser): Promise<string | null> {
  if (!user.employeeEid) return null;

  const rows = await db
    .selectDistinct({ manager: employees.managerName })
    .from(employees)
    .where(eq(employees.supervisorEid, user.employeeEid));

  const names = rows.map((r) => r.manager).filter((n): n is string => Boolean(n));
  // A team split across two managers has no single approver; treat that as
  // unresolved rather than picking one arbitrarily.
  return names.length === 1 ? names[0] : null;
}

/** Whether `decider` may approve leave for `requester`, neither having an employee row. */
export async function canDecideForLeader(
  decider: CurrentUser,
  requester: CurrentUser,
): Promise<boolean> {
  if (decider.id === requester.id) return false;
  if (decider.role === "admin") return true;
  if (decider.role !== "manager") return false;

  const deciderName = decider.managerName ?? decider.name;
  const requestersManager = await managerNameFor(requester);
  return requestersManager !== null && requestersManager === deciderName;
}

/**
 * Accounts whose own leave this user decides — supervisors, who have no
 * employee row and so cannot be found through the employee scope.
 *
 * The same single-manager rule as `canDecideForLeader`, expressed once in SQL
 * so the queue a manager is shown matches the requests they can actually act
 * on. A queue offering a button that then refuses is worse than an empty one.
 */
export async function decidableLeaderIds(user: CurrentUser): Promise<string[]> {
  if (user.role === "admin") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ["supervisor", "manager"]), ne(users.id, user.id)));
    return rows.map((r) => r.id);
  }
  if (user.role !== "manager") return [];

  const name = user.managerName ?? user.name;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(employees, eq(employees.supervisorEid, users.employeeEid))
    .where(and(eq(users.role, "supervisor"), ne(users.id, user.id)))
    .groupBy(users.id)
    .having(
      sql`count(distinct ${employees.managerName}) = 1 and max(${employees.managerName}) = ${name}`,
    );
  return rows.map((r) => r.id);
}

/** Which slice of the organization a leave calendar is showing. */
export type PtoView = "team" | "cluster";

/**
 * Whether this user has a cluster distinct from their own team.
 *
 * Only supervisors do: their team is their direct reports, their cluster is
 * everyone under the same manager. A manager's team already *is* the cluster,
 * and an agent is deliberately kept to their own team.
 */
export async function hasCluster(user: CurrentUser): Promise<boolean> {
  return user.role === "supervisor" && (await managerNameFor(user)) !== null;
}

/** Employee ids visible in the chosen view, defaulting to the user's own team. */
export async function ptoViewIds(user: CurrentUser, view: PtoView): Promise<string[]> {
  if (view === "team" || user.role !== "supervisor") return ptoScopeIds(user);

  const manager = await managerNameFor(user);
  if (manager === null) return ptoScopeIds(user);

  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.managerName, manager));
  return rows.map((r) => r.id);
}

/**
 * Accounts belonging to the supervisors of a set of employees.
 *
 * A supervisor has no employee row, so their own leave would otherwise be
 * invisible on the calendar of the team it affects — which is exactly the
 * team that needs to know their supervisor is out.
 */
export async function leaderAccountsOver(employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];

  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(employees, eq(employees.supervisorEid, users.employeeEid))
    .where(inArray(employees.id, employeeIds));
  return rows.map((r) => r.id);
}
