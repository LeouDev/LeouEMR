import { actionPlanLabel, EWS_ATTRITION_LABELS, EWS_RISK_LABELS } from "./engine";
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

export interface LeaveRegisterRow {
  supervisorName: string | null;
  name: string;
  eid: string;
  attrition: "absconding" | "loa" | "maternity";
  started: string | null;
  expectedReturn: string | null;
  notes: string | null;
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
