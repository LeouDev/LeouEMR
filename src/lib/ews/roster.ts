import { autoFlags, isAutoIndicator, type AutoIndicator, type AutoIndicatorCode } from "./auto-indicators";
import { computeEwsRisk, isLeaveState, type EwsAttrition, type EwsRiskLevel } from "./engine";

/**
 * The My Team roster as the page reads it: every person in scope with
 * their live risk, worst first. Pure — the query gathers the people, the
 * latest assessment each has, the score of the one before it and the data
 * week's figures, and this decides what the row says.
 *
 * "Live" because three of the indicators come from the weekly data (see
 * auto-indicators.ts): the score shown is the supervisor's ticks plus what
 * this week's figures say, whether or not anyone has saved since the
 * import. The stored score is what it was at the last save; the trend
 * column compares the live score with the save before that.
 */

export interface EwsLatestAssessment {
  week: string;
  indicators: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
  attritionDate: string | null;
  expectedReturn: string | null;
  actionPlan: string | null;
  notes: string | null;
  /** As stored at the last save. */
  score: number;
  /** ISO timestamp of the last save. */
  updatedAt: string;
  assessedByName: string | null;
}

export interface EwsRosterPerson {
  employeeId: string;
  eid: string;
  name: string;
  position: string | null;
  supervisorEid: string | null;
  supervisorName: string | null;
  latest: EwsLatestAssessment | null;
  /** The stored score of the assessment before the latest; null when there is none. */
  previousScore: number | null;
  auto: Record<AutoIndicatorCode, AutoIndicator>;
}

export interface EwsRosterRow extends EwsRosterPerson {
  /** The supervisor's own ticks — the stored flags with the derived codes taken out. */
  manual: Record<string, boolean>;
  capActive: boolean;
  attrition: EwsAttrition;
  score: number;
  riskLevel: EwsRiskLevel;
  /** Live score against the previous save; null without one to compare. */
  delta: number | null;
  flag: "leave" | null;
}

/** The stored flags without the derived codes, which the data answers instead. */
export function manualFlags(indicators: Record<string, boolean> | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [code, on] of Object.entries(indicators ?? {})) {
    if (!isAutoIndicator(code) && on) out[code] = true;
  }
  return out;
}

export function buildRosterRow(person: EwsRosterPerson): EwsRosterRow {
  const manual = manualFlags(person.latest?.indicators);
  const capActive = person.latest?.capActive ?? false;
  const attrition = person.latest?.attrition ?? "none";
  const { score, riskLevel } = computeEwsRisk({
    indicators: { ...manual, ...autoFlags(person.auto) },
    capActive,
    attrition,
  });
  return {
    ...person,
    manual,
    capActive,
    attrition,
    score,
    riskLevel,
    delta: person.previousScore === null ? null : score - person.previousScore,
    flag: isLeaveState(attrition) ? "leave" : null,
  };
}

const RISK_RANK: Record<EwsRiskLevel, number> = { BLACK: 0, RED: 1, YELLOW: 2, GREEN: 3 };

/** Worst first — Critical, At risk, Watch, then Stable — and by name inside a band. */
export function sortRoster(rows: readonly EwsRosterRow[]): EwsRosterRow[] {
  return [...rows].sort((a, b) => RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel] || a.name.localeCompare(b.name));
}

export interface RosterTotals {
  black: number;
  red: number;
  yellow: number;
  green: number;
  size: number;
}

export function rosterTotals(rows: readonly EwsRosterRow[]): RosterTotals {
  const totals: RosterTotals = { black: 0, red: 0, yellow: 0, green: 0, size: rows.length };
  for (const row of rows) {
    if (row.riskLevel === "BLACK") totals.black += 1;
    else if (row.riskLevel === "RED") totals.red += 1;
    else if (row.riskLevel === "YELLOW") totals.yellow += 1;
    else totals.green += 1;
  }
  return totals;
}

/** Name, employee ID, position or team leader containing the typed text, case-insensitively. */
export function filterRoster<T extends Pick<EwsRosterRow, "name" | "eid" | "position" | "supervisorName">>(
  rows: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...rows];
  return rows.filter((r) =>
    [r.name, r.eid, r.position ?? "", r.supervisorName ?? ""].some((field) => field.toLowerCase().includes(q)),
  );
}

/** "just now", "3 hours ago", "6 days ago", then the date. */
export function relativeTime(iso: string, now: string): string {
  const then = new Date(iso).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(at)) return "—";
  const minutes = Math.round((at - then) / 60_000);
  if (minutes < 60) return "just now";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
