/**
 * The utilization report: who is using the app day to day, and how many
 * end-of-day reports go out, by team and by manager. Pure — the query
 * gathers the accounts, their activity days and their EOD sends, and this
 * folds them into what the page shows.
 *
 * An "active" account is one that opened the app on at least one day of
 * the range. The day is the Manila calendar day the team works in.
 */

export type UtilizationRole = "admin" | "manager" | "supervisor" | "agent" | "trainer" | "sme";

export interface UtilizationAccount {
  userId: string;
  name: string;
  role: UtilizationRole;
  /** The team leader this account sits under — a leader's own team, an agent's leader; null for managers and administrators. */
  team: string | null;
  manager: string | null;
  /** The days in range the account opened the app, YYYY-MM-DD. */
  activeDays: string[];
  /** ISO timestamp of the last time the app saw them, in or out of range; null never. */
  lastSeen: string | null;
  /** End-of-day reports sent in the range, by Manila day. */
  eodDays: Record<string, number>;
}

export interface DayPoint {
  day: string;
  label: string;
  activeUsers: number;
  eodSent: number;
}

export interface UtilizationBand {
  key: string;
  label: string;
  accounts: number;
  /** Accounts active on at least one day of the range. */
  active: number;
  /** Active over accounts, whole percent; null with no accounts. */
  activeRate: number | null;
  /** Mean active days per account, over every account in the band. */
  avgActiveDays: number;
  eodSent: number;
  members: UtilizationMember[];
}

export interface UtilizationMember {
  userId: string;
  name: string;
  role: UtilizationRole;
  team: string | null;
  manager: string | null;
  activeDays: number;
  lastSeen: string | null;
  eodSent: number;
}

export const NO_TEAM = "Leadership & support";
export const NO_MANAGER = "No manager of record";

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every day from `start` to `end` inclusive. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = utc(start); iso(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
}

const shortDay = (day: string) => utc(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Active accounts and EOD reports per day of the range, oldest first. */
export function dailySeries(accounts: readonly UtilizationAccount[], start: string, end: string): DayPoint[] {
  return daysBetween(start, end).map((day) => ({
    day,
    label: shortDay(day),
    activeUsers: accounts.filter((a) => a.activeDays.includes(day)).length,
    eodSent: accounts.reduce((sum, a) => sum + (a.eodDays[day] ?? 0), 0),
  }));
}

function member(a: UtilizationAccount): UtilizationMember {
  return {
    userId: a.userId,
    name: a.name,
    role: a.role,
    team: a.team,
    manager: a.manager,
    activeDays: a.activeDays.length,
    lastSeen: a.lastSeen,
    eodSent: Object.values(a.eodDays).reduce((sum, n) => sum + n, 0),
  };
}

function band(key: string, label: string, accounts: readonly UtilizationAccount[]): UtilizationBand {
  const members = accounts.map(member).sort((x, y) => y.activeDays - x.activeDays || x.name.localeCompare(y.name));
  const active = members.filter((m) => m.activeDays > 0).length;
  return {
    key,
    label,
    accounts: members.length,
    active,
    activeRate: members.length === 0 ? null : Math.round((active / members.length) * 100),
    avgActiveDays: members.length === 0 ? 0 : Math.round((members.reduce((s, m) => s + m.activeDays, 0) / members.length) * 10) / 10,
    eodSent: members.reduce((s, m) => s + m.eodSent, 0),
    members,
  };
}

/** Most active teams first, by active rate then mean days; the no-team band last. */
function order(bands: UtilizationBand[], last: string): UtilizationBand[] {
  return bands.sort((a, b) => {
    if (a.key === last) return 1;
    if (b.key === last) return -1;
    return (b.activeRate ?? -1) - (a.activeRate ?? -1) || b.avgActiveDays - a.avgActiveDays || a.label.localeCompare(b.label);
  });
}

/** One band per team leader, with the leader's own account in their team. */
export function groupByTeam(accounts: readonly UtilizationAccount[]): UtilizationBand[] {
  const by = new Map<string, UtilizationAccount[]>();
  for (const a of accounts) {
    const key = a.team ?? NO_TEAM;
    by.set(key, [...(by.get(key) ?? []), a]);
  }
  return order([...by.entries()].map(([key, rows]) => band(key, key, rows)), NO_TEAM);
}

/** One band per manager of record, everyone under them — leaders and agents alike. */
export function groupByManager(accounts: readonly UtilizationAccount[]): UtilizationBand[] {
  const by = new Map<string, UtilizationAccount[]>();
  for (const a of accounts) {
    const key = a.manager ?? NO_MANAGER;
    by.set(key, [...(by.get(key) ?? []), a]);
  }
  return order([...by.entries()].map(([key, rows]) => band(key, key, rows)), NO_MANAGER);
}

export interface UtilizationTotals {
  accounts: number;
  active: number;
  activeRate: number | null;
  /** Mean of the daily active counts over the range's days. */
  avgDailyActive: number;
  eodSent: number;
  /** Accounts active on the last day of the range. */
  activeOnLastDay: number;
}

export function totals(accounts: readonly UtilizationAccount[], series: readonly DayPoint[]): UtilizationTotals {
  const active = accounts.filter((a) => a.activeDays.length > 0).length;
  const last = series[series.length - 1];
  return {
    accounts: accounts.length,
    active,
    activeRate: accounts.length === 0 ? null : Math.round((active / accounts.length) * 100),
    avgDailyActive: series.length === 0 ? 0 : Math.round((series.reduce((s, p) => s + p.activeUsers, 0) / series.length) * 10) / 10,
    eodSent: series.reduce((s, p) => s + p.eodSent, 0),
    activeOnLastDay: last?.activeUsers ?? 0,
  };
}

/** The range the page shows: the last `days` Manila days ending today. */
export function rangeEnding(today: string, days: number): { start: string; end: string } {
  const start = utc(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: iso(start), end: today };
}

export const RANGE_OPTIONS = [7, 14, 30, 90] as const;

export function parseDays(value: string | undefined): (typeof RANGE_OPTIONS)[number] {
  const n = Number(value);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as (typeof RANGE_OPTIONS)[number]) : 30;
}

/** The Manila calendar day of an instant, YYYY-MM-DD — the day the team works in. */
export function manilaDay(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/**
 * The same series by reporting week (Sunday to Saturday, the operation's
 * week) for a range too long to read day by day: distinct accounts active
 * in the week, and the week's EOD reports.
 */
export function weeklySeries(accounts: readonly UtilizationAccount[], start: string, end: string): DayPoint[] {
  const weeks = new Map<string, { day: string; end: string; users: Set<string>; eod: number }>();
  for (const day of daysBetween(start, end)) {
    const d = utc(day);
    const sunday = new Date(d);
    sunday.setUTCDate(sunday.getUTCDate() - d.getUTCDay());
    const key = iso(sunday);
    const week = weeks.get(key) ?? { day: key, end: day, users: new Set<string>(), eod: 0 };
    week.end = day;
    for (const a of accounts) {
      if (a.activeDays.includes(day)) week.users.add(a.userId);
      week.eod += a.eodDays[day] ?? 0;
    }
    weeks.set(key, week);
  }
  return [...weeks.values()].map((w) => ({ day: w.day, label: `${shortDay(w.day)} wk`, activeUsers: w.users.size, eodSent: w.eod }));
}
