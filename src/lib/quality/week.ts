/**
 * The audit week and what each agent owes in it.
 *
 * Audit weeks run Sunday to Saturday — the calendar week the floor plans
 * by — unlike the reporting weeks elsewhere in the app, which follow the
 * source workbook's Saturday-to-Friday "WE" labels. The two never meet:
 * nothing here is compared with a KPI week.
 */

/** Audits owed per active agent per week. */
export const AUDITS_PER_AGENT = 2;

export interface AuditWeek {
  /** Sunday, ISO date. */
  start: string;
  /** Saturday, ISO date. */
  end: string;
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function auditWeekOf(date: string): AuditWeek {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: iso(d), end: iso(end) };
}

export function shiftWeek(week: AuditWeek, weeks: number): AuditWeek {
  const d = utc(week.start);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return auditWeekOf(iso(d));
}

/** A real calendar date in ISO form — "2026-02-30" and "2026-13-01" are not. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = utc(value);
  return !Number.isNaN(d.getTime()) && iso(d) === value;
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export function isAuditWeekStart(date: string | undefined): date is string {
  return isIsoDate(date) && auditWeekOf(date).start === date;
}

/** "Sep 7 – Sep 13, 2026" */
export function weekLabel(week: AuditWeek): string {
  const fmt = (date: string, year: boolean) =>
    utc(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(year ? { year: "numeric" } : {}) });
  return `${fmt(week.start, false)} – ${fmt(week.end, true)}`;
}

export interface DateSpan {
  start: string;
  end: string;
}

/** How many of the week's seven days fall inside at least one span. */
export function daysCovered(week: AuditWeek, spans: readonly DateSpan[]): number {
  let covered = 0;
  const cursor = utc(week.start);
  for (let i = 0; i < 7; i++) {
    const day = iso(cursor);
    if (spans.some((span) => span.start <= day && day <= span.end)) covered++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return covered;
}

export type AgentWeekStanding = "active" | "out_all_week" | "on_leave" | "separated";

export const STANDING_LABELS: Record<AgentWeekStanding, string> = {
  active: "Active",
  out_all_week: "Out all week",
  on_leave: "On leave",
  separated: "Separated",
};

/**
 * Whether an agent is active for the week — and so owes audits — or out of
 * it: gone before it started, on a leave of absence, or on approved leave
 * every day of it.
 */
export function standingFor(
  agent: { status: "active" | "on_leave" | "separated"; separatedOn: string | null; leave: readonly DateSpan[] },
  week: AuditWeek,
): AgentWeekStanding {
  if (agent.separatedOn !== null && agent.separatedOn < week.start) return "separated";
  if (agent.status === "separated" && agent.separatedOn === null) return "separated";
  if (agent.status === "on_leave") return "on_leave";
  if (daysCovered(week, agent.leave) >= 7) return "out_all_week";
  return "active";
}

export function requiredFor(standing: AgentWeekStanding): number {
  return standing === "active" ? AUDITS_PER_AGENT : 0;
}
