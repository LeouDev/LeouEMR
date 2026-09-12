import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeAssignments, employees, users } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { resolveScopedIds } from "@/lib/queries/performance";
import {
  type DateRange,
  joinPeriodOwner,
  managerOfRecord,
  periodOwnerSubquery,
  reportingScopeIds,
  supervisorEidOfRecord,
} from "@/lib/queries/org-history";

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
 * A report as the roster of record has it now: an employee with an open
 * assignment interval. A row that merely still names the supervisor is not
 * one — a masterlist that closes someone as attrited never rewrites their
 * employee row, so it keeps naming their last supervisor and last manager
 * indefinitely. Counting those rows as reports is what put one supervisor
 * under three managers at once and took both her cluster view and her
 * manager's approval of her leave away.
 */
const currentlyAssigned = sql`exists (
  select 1 from ${employeeAssignments} as a
  where a.employee_id = ${employees.id} and a.effective_to is null
)`;

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
    .where(and(eq(employees.supervisorEid, user.employeeEid), currentlyAssigned));

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
    .where(and(eq(users.role, "supervisor"), ne(users.id, user.id), currentlyAssigned))
    .groupBy(users.id)
    .having(
      sql`count(distinct ${employees.managerName}) = 1 and max(${employees.managerName}) = ${name}`,
    );
  return rows.map((r) => r.id);
}

/**
 * The name most of a list carries, or null when nothing leads outright — an
 * empty list, or a tie. Blank entries are not candidates.
 */
export function majorityName(names: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/**
 * The manager whose cluster a supervisor belongs to, for the calendar of one
 * month: the manager most of the supervisor's reports for that month sat
 * under, by the structure of record (see periodOwnerSubquery).
 *
 * Looser than `managerNameFor` on purpose. That one decides who may approve
 * the supervisor's own leave, where a team split across two managers rightly
 * has no single approver. This only decides which people the supervisor may
 * *see* out, and one report whose row names another manager — a roster
 * miss, a name written two ways — should not take the whole cluster view
 * away. A genuine even split still resolves to nobody.
 */
async function clusterManagerFor(user: CurrentUser, period: DateRange): Promise<string | null> {
  const team = await reportingScopeIds(user, period);
  // No team this month — between teams, or one not yet on the roster —
  // does not mean no cluster: they still sit under the manager their
  // reports last did.
  if (team.length === 0) return lastKnownManagerFor(user);

  const owner = periodOwnerSubquery(period);
  const rows = await db
    .select({ manager: managerOfRecord(owner) })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(inArray(employees.id, team));
  return majorityName(rows.map((r) => r.manager));
}

/**
 * The manager a supervisor's reports most recently sat under, from the whole
 * assignment history: the cluster a team leader still belongs to in a month
 * they have no team in. The manager of their latest stint, the more common
 * one breaking a tie; null for someone whose reports never named a manager.
 */
async function lastKnownManagerFor(user: CurrentUser): Promise<string | null> {
  if (!user.employeeEid) return null;
  const [row] = await db
    .select({ manager: employeeAssignments.managerName })
    .from(employeeAssignments)
    .where(and(eq(employeeAssignments.supervisorEid, user.employeeEid), isNotNull(employeeAssignments.managerName)))
    .groupBy(employeeAssignments.managerName)
    .orderBy(sql`max(${employeeAssignments.effectiveFrom}) desc`, sql`count(*) desc`)
    .limit(1);
  return row?.manager ?? null;
}

/** Which slice of the organization a leave calendar is showing. */
export type PtoView = "team" | "cluster";

/**
 * Every calendar view, across roles. A supervisor chooses between their
 * direct reports and their manager's whole cluster; a manager, whose span
 * already is the cluster, chooses instead between everyone in it, the agents
 * alone, or the team leaders alone — the two kinds of leave they decide are
 * read differently (cover for a floor, cover for a team), so each gets a
 * calendar of its own.
 */
export type CalendarView = PtoView | "everyone" | "agents" | "leaders";

const MANAGER_VIEWS: readonly CalendarView[] = ["everyone", "agents", "leaders"];
const SUPERVISOR_VIEWS: readonly CalendarView[] = ["team", "cluster"];

/** The view a role may ask for, falling back to its default for anything else. */
export function calendarViewFor(role: CurrentUser["role"], requested: string | undefined): CalendarView {
  const allowed: readonly CalendarView[] =
    role === "manager" ? MANAGER_VIEWS : role === "supervisor" ? SUPERVISOR_VIEWS : ["team"];
  return allowed.includes(requested as CalendarView) ? (requested as CalendarView) : allowed[0];
}

/**
 * Whether this user has a cluster distinct from their own team for the
 * month being viewed.
 *
 * Only supervisors do: their team is their direct reports, their cluster is
 * everyone under the same manager. A manager's team already *is* the cluster,
 * and an agent is deliberately kept to their own team.
 */
export async function hasCluster(user: CurrentUser, period: DateRange): Promise<boolean> {
  return user.role === "supervisor" && (await clusterManagerFor(user, period)) !== null;
}

/**
 * Employee ids visible on the calendar for one month, in the chosen view.
 *
 * A leader's calendar for a month shows the team as it stood that month, by
 * the structure of record — the same rule the dashboard follows — not who
 * reports to them today. A team leader whose team has since moved on still
 * sees June's leave on June's calendar; one whose team arrived in September
 * does not see them on June's. Who a leader may *decide* for is a separate
 * question and stays on the current structure. An agent's calendar is their
 * team now, since that is who they arrange cover with.
 *
 * For a supervisor's cluster view these are the cluster's agents, but the
 * page draws only the leaders over them: the view is the other team leaders'
 * leave, not their reports' (see the leaders-only rule on the page).
 */
export async function ptoViewIds(user: CurrentUser, view: PtoView, period: DateRange): Promise<string[]> {
  if (user.role === "agent" || user.role === "admin") return ptoScopeIds(user);
  if (view === "team" || user.role !== "supervisor") return reportingScopeIds(user, period);

  const manager = await clusterManagerFor(user, period);
  if (manager === null) return reportingScopeIds(user, period);

  const owner = periodOwnerSubquery(period);
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(eq(managerOfRecord(owner), manager));
  return rows.map((r) => r.id);
}

/**
 * Accounts belonging to the supervisors of a set of employees, as of one
 * month — whoever led them then, by the structure of record.
 *
 * A supervisor has no employee row, so their own leave would otherwise be
 * invisible on the calendar of the team it affects — which is exactly the
 * team that needs to know their supervisor is out.
 */
export async function leaderAccountsOver(employeeIds: string[], period: DateRange): Promise<string[]> {
  if (employeeIds.length === 0) return [];

  const owner = periodOwnerSubquery(period);
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .innerJoin(users, eq(users.employeeEid, supervisorEidOfRecord(owner)))
    .where(inArray(employees.id, employeeIds));
  return rows.map((r) => r.id);
}
