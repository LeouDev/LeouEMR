import { auditWeekOf, shiftWeek, type AgentWeekStanding, type AuditWeek } from "./week";

/**
 * The weekly audit requirement rolled up per team leader: how many audits
 * their active agents owed in the week, how many were filed, and the share
 * — the Audit completion chart's rows. Pure, so the roll-up is pinned by
 * tests rather than read off a chart.
 */

export interface LeaderCompletion {
  leader: string;
  /** Agents who owed audits in the week. */
  activeAgents: number;
  required: number;
  completed: number;
  /** Whole percent of required, not capped: a team that filed extra reads above 100. */
  completionPct: number;
}

export const UNASSIGNED_LEADER = "Unassigned";

export function completionByLeader(
  rows: ReadonlyArray<{
    supervisorName: string | null;
    standing: AgentWeekStanding;
    required: number;
    completed: number;
  }>,
): LeaderCompletion[] {
  const byLeader = new Map<string, LeaderCompletion>();
  for (const row of rows) {
    const leader = row.supervisorName ?? UNASSIGNED_LEADER;
    const entry = byLeader.get(leader) ?? { leader, activeAgents: 0, required: 0, completed: 0, completionPct: 0 };
    if (row.standing === "active") entry.activeAgents += 1;
    entry.required += row.required;
    entry.completed += row.completed;
    byLeader.set(leader, entry);
  }

  // A leader whose whole team owed nothing that week (all on leave, all
  // separated) has no completion to show; a bar for them would be a
  // division by zero dressed up as a number.
  return [...byLeader.values()]
    .filter((entry) => entry.required > 0)
    .map((entry) => ({ ...entry, completionPct: Math.round((entry.completed / entry.required) * 100) }))
    .sort((a, b) => a.leader.localeCompare(b.leader));
}

/** `YYYY-MM-01` for `YYYY-MM`; today's month for anything else. */
export function monthStartOf(value: string | undefined, today: string): string {
  const match = value && /^(\d{4})-(\d{2})$/.exec(value);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1]}-${match[2]}-01`;
  return `${today.slice(0, 7)}-01`;
}

export function shiftMonth(monthStart: string, months: number): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** "September 2026" */
export function monthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The audit weeks of a month: every Sunday-to-Saturday week that begins
 * in it — four in most months, five when the month has five Sundays. A
 * week that begins in the month and runs into the next belongs to this
 * one; the week that began in the previous month and runs into this one
 * belongs to that one.
 */
export function auditWeeksOfMonth(monthStart: string): AuditWeek[] {
  const weeks: AuditWeek[] = [];
  let week = auditWeekOf(monthStart);
  if (week.start < monthStart) week = shiftWeek(week, 1);
  const next = shiftMonth(monthStart, 1);
  while (week.start < next) {
    weeks.push(week);
    week = shiftWeek(week, 1);
  }
  return weeks;
}

export interface WeekCell {
  week: AuditWeek;
  required: number;
  completed: number;
  /** Null when the team owed nothing that week. */
  completionPct: number | null;
}

export interface LeaderMonth {
  leader: string;
  cells: WeekCell[];
  required: number;
  completed: number;
  completionPct: number | null;
}

/**
 * Every team leader who owed audits in any week of the month, with one
 * cell per week — the grouped chart's bars — and the month's total. A
 * leader is listed once they owe in any week, and a week they owed
 * nothing in stays an empty cell rather than a zero.
 */
export function completionGrid(
  weeks: readonly AuditWeek[],
  rowsByWeek: ReadonlyArray<
    ReadonlyArray<{ supervisorName: string | null; standing: AgentWeekStanding; required: number; completed: number }>
  >,
): LeaderMonth[] {
  const perWeek = rowsByWeek.map((rows) => new Map(completionByLeader(rows).map((l) => [l.leader, l])));
  const leaders = [...new Set(perWeek.flatMap((m) => [...m.keys()]))].sort((a, b) => a.localeCompare(b));

  return leaders.map((leader) => {
    const cells: WeekCell[] = weeks.map((week, i) => {
      const entry = perWeek[i]?.get(leader);
      return entry
        ? { week, required: entry.required, completed: entry.completed, completionPct: entry.completionPct }
        : { week, required: 0, completed: 0, completionPct: null };
    });
    const required = cells.reduce((sum, c) => sum + c.required, 0);
    const completed = cells.reduce((sum, c) => sum + c.completed, 0);
    return {
      leader,
      cells,
      required,
      completed,
      completionPct: required === 0 ? null : Math.round((completed / required) * 100),
    };
  });
}
