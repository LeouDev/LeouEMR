import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, employees, userActivityDays, users } from "@/lib/db/schema";
import type { UtilizationAccount, UtilizationRole } from "@/lib/utilization/report";

/**
 * Every active account with the days it opened the app in a range and the
 * end-of-day reports it sent, placed on its team and under its manager.
 *
 * Two sources say someone was here: the daily ping (`user_activity_days`,
 * from the day it went live) and anything they wrote that the audit log
 * recorded — an EOD report sent, an audit filed, a record saved. The
 * second reaches back before the ping existed, so the report has some
 * history from day one; it undercounts people who only read, which the
 * ping then fills in. The day is the Manila calendar day throughout.
 *
 * Team and manager come from the roster: an agent's leader and manager of
 * record; a leader's own team, named after them, and their manager; a
 * manager stands as the manager they are linked to. Administrators and
 * unlinked support accounts have neither.
 */
export async function getUtilization(range: { start: string; end: string }): Promise<UtilizationAccount[]> {
  const accounts = await db
    .select({ id: users.id, name: users.name, role: users.role, employeeEid: users.employeeEid, managerName: users.managerName })
    .from(users)
    .where(eq(users.status, "active"));
  if (accounts.length === 0) return [];
  const ids = accounts.map((a) => a.id);
  const eids = accounts.map((a) => a.employeeEid).filter((e): e is string => e !== null);

  const manilaDay = (column: typeof auditLog.createdAt) => sql<string>`(${column} at time zone 'Asia/Manila')::date::text`;
  // Manila midnight of the range's first day, as an instant, so the audit
  // scan is bounded by the index rather than by a per-row conversion.
  const since = sql`(${range.start}::date::timestamp at time zone 'Asia/Manila')`;

  const [rosterRows, ledRows, activity, lastSeenRows, audits] = await Promise.all([
    eids.length > 0
      ? db
          .select({ eid: employees.eid, name: employees.name, supervisorName: employees.supervisorName, managerName: employees.managerName })
          .from(employees)
          .where(inArray(employees.eid, eids))
      : Promise.resolve([]),
    // A leader's manager, read off the people they lead, for a leader with
    // no roster row of their own.
    eids.length > 0
      ? db
          .selectDistinct({ supervisorEid: employees.supervisorEid, managerName: employees.managerName })
          .from(employees)
          .where(inArray(employees.supervisorEid, eids))
      : Promise.resolve([]),
    db
      .select({ userId: userActivityDays.userId, day: sql<string>`${userActivityDays.day}::text` })
      .from(userActivityDays)
      .where(and(inArray(userActivityDays.userId, ids), gte(userActivityDays.day, range.start), lte(userActivityDays.day, range.end)))
      .catch(() => [] as Array<{ userId: string; day: string }>),
    db
      .select({ userId: userActivityDays.userId, lastSeen: sql<string>`max(${userActivityDays.lastSeen})::text` })
      .from(userActivityDays)
      .where(inArray(userActivityDays.userId, ids))
      .groupBy(userActivityDays.userId)
      .catch(() => [] as Array<{ userId: string; lastSeen: string }>),
    db
      .select({
        actorId: auditLog.actorId,
        action: auditLog.action,
        day: manilaDay(auditLog.createdAt),
        n: sql<number>`count(*)::int`,
        last: sql<string>`max(${auditLog.createdAt})::text`,
      })
      .from(auditLog)
      .where(and(inArray(auditLog.actorId, ids), gte(auditLog.createdAt, since)))
      .groupBy(auditLog.actorId, auditLog.action, manilaDay(auditLog.createdAt)),
  ]);

  const roster = new Map(rosterRows.map((r) => [r.eid, r]));
  const ledManager = new Map<string, string | null>();
  for (const r of ledRows) if (r.supervisorEid && !ledManager.has(r.supervisorEid)) ledManager.set(r.supervisorEid, r.managerName);

  const activeDays = new Map<string, Set<string>>();
  const eodDays = new Map<string, Record<string, number>>();
  const lastSeen = new Map<string, string>();
  const noteSeen = (id: string, at: string) => {
    const current = lastSeen.get(id);
    if (!current || at > current) lastSeen.set(id, at);
  };
  for (const row of activity) {
    activeDays.set(row.userId, (activeDays.get(row.userId) ?? new Set()).add(row.day));
  }
  for (const row of lastSeenRows) noteSeen(row.userId, new Date(row.lastSeen).toISOString());
  for (const row of audits) {
    if (!row.actorId) continue;
    if (row.day >= range.start && row.day <= range.end) {
      activeDays.set(row.actorId, (activeDays.get(row.actorId) ?? new Set()).add(row.day));
      if (row.action === "eod.sent") {
        const days = eodDays.get(row.actorId) ?? {};
        days[row.day] = (days[row.day] ?? 0) + Number(row.n);
        eodDays.set(row.actorId, days);
      }
    }
    noteSeen(row.actorId, new Date(row.last).toISOString());
  }

  return accounts.map((a) => {
    const own = a.employeeEid ? roster.get(a.employeeEid) : undefined;
    let team: string | null = null;
    let manager: string | null = null;
    if (a.role === "supervisor") {
      team = own?.name ?? a.name;
      manager = own?.managerName ?? (a.employeeEid ? (ledManager.get(a.employeeEid) ?? null) : null);
    } else if (a.role === "manager") {
      manager = a.managerName ?? a.name;
    } else if (a.role !== "admin") {
      team = own?.supervisorName ?? null;
      manager = own?.managerName ?? null;
    }
    return {
      userId: a.id,
      name: a.name,
      role: a.role as UtilizationRole,
      team,
      manager,
      activeDays: [...(activeDays.get(a.id) ?? [])].sort(),
      lastSeen: lastSeen.get(a.id) ?? null,
      eodDays: eodDays.get(a.id) ?? {},
    };
  });
}
