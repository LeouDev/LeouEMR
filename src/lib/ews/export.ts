import { actionPlanLabel, EWS_ATTRITION_LABELS, EWS_RISK_LABELS, expectsReturn, isExit } from "./engine";
import type { EwsRosterRow } from "./roster";

/**
 * The EWS screens as rows a spreadsheet can hold. Pure, so the files'
 * contents are tested without a route.
 */

export interface IndicatorColumn {
  code: string;
  label: string;
}

/** The roster: every column the table shows, then one YES/NO column per indicator. */
export function ewsRosterExportHeader(indicators: readonly IndicatorColumn[]): string[] {
  return [
    "Team leader",
    "Employee",
    "EID",
    "Position",
    "Risk",
    "Score",
    "Vs last week",
    "Active CAP",
    "Action plan",
    "Attrition / leave status",
    "Effective / start date",
    "Expected return",
    "Last assessed week",
    "Assessed by",
    "Remarks",
    ...indicators.map((i) => i.label),
  ];
}

const yes = (flag: boolean) => (flag ? "YES" : "NO");

export function ewsRosterExportRows(
  rows: readonly EwsRosterRow[],
  indicators: readonly IndicatorColumn[],
): Array<Array<string | number>> {
  return rows.map((row) => {
    const auto = row.auto as Record<string, { on: boolean } | undefined>;
    return [
      row.supervisorName ?? "",
      row.name,
      row.eid,
      row.position ?? "",
      EWS_RISK_LABELS[row.riskLevel],
      row.score,
      row.delta === null ? "" : row.delta > 0 ? `+${row.delta}` : String(row.delta),
      yes(row.capActive),
      actionPlanLabel(row.latest?.actionPlan ?? null) ?? "",
      row.attrition === "none" ? "" : EWS_ATTRITION_LABELS[row.attrition],
      row.latest?.attritionDate ?? "",
      row.latest?.expectedReturn ?? "",
      row.latest?.week ?? "",
      row.latest?.assessedByName ?? "",
      row.latest?.notes ?? "",
      ...indicators.map((i) => yes(auto[i.code]?.on ?? row.manual[i.code] ?? false)),
    ];
  });
}

/** `ews-roster-2026-09-22`, or with the team leader's EID when narrowed to one team. */
export function ewsRosterExportFilename(today: string, team: string | null): string {
  return `ews-roster${team ? `-${team}` : ""}-${today}`;
}

export const LEAVE_REGISTER_EXPORT_HEADER: readonly string[] = [
  "Team leader",
  "Employee",
  "EID",
  "Type",
  "Started",
  "Expected return",
  "Status",
  "Remarks",
];

/** A confirmed exit — resignation, termination or absconding — as the attrition table lists it. */
export interface ExitRow {
  employeeId: string;
  name: string;
  eid: string;
  position: string | null;
  supervisorName: string | null;
  attrition: "black" | "absconding";
  /** The effective date, or the week of the record that carries the tag. */
  date: string | null;
}

/** Whoever's latest record carries an exit tag, newest exit first. */
export function exitRowsOf(rows: readonly EwsRosterRow[]): ExitRow[] {
  return rows
    .filter((r): r is EwsRosterRow & { attrition: "black" | "absconding" } => isExit(r.attrition))
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      eid: r.eid,
      position: r.position,
      supervisorName: r.supervisorName,
      attrition: r.attrition,
      date: r.latest?.attritionDate ?? r.latest?.week ?? null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name));
}

export interface LeaveRegisterRow {
  employeeId: string;
  supervisorName: string | null;
  name: string;
  eid: string;
  attrition: "loa" | "maternity";
  started: string | null;
  expectedReturn: string | null;
  notes: string | null;
}

/** Whoever's latest record carries a leave they are expected back from, by name. */
export function leaveRowsOf(rows: readonly EwsRosterRow[]): LeaveRegisterRow[] {
  return rows
    .filter((r): r is EwsRosterRow & { attrition: "loa" | "maternity" } => expectsReturn(r.attrition))
    .map((r) => ({
      employeeId: r.employeeId,
      supervisorName: r.supervisorName,
      name: r.name,
      eid: r.eid,
      attrition: r.attrition,
      started: r.latest?.attritionDate ?? null,
      expectedReturn: r.latest?.expectedReturn ?? null,
      notes: r.latest?.notes ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the person should be back by now. */
export function returnOverdue(row: Pick<LeaveRegisterRow, "expectedReturn">, today: string): boolean {
  return row.expectedReturn !== null && row.expectedReturn < today;
}

export function leaveRegisterExportRows(rows: readonly LeaveRegisterRow[], today: string): Array<Array<string | number>> {
  return rows.map((row) => [
    row.supervisorName ?? "",
    row.name,
    row.eid,
    EWS_ATTRITION_LABELS[row.attrition],
    row.started ?? "",
    row.expectedReturn ?? "",
    returnOverdue(row, today) ? "Return overdue" : "On leave",
    row.notes ?? "",
  ]);
}

export function leaveRegisterExportFilename(today: string): string {
  return `ews-leave-register-${today}`;
}
