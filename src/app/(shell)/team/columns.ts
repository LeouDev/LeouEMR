/**
 * The roster table's shape, shared by the server page that fills it and the
 * client component that draws it.
 *
 * Deliberately its own module with no "use client" directive, for the reason
 * spelled out in dashboard/kpi-groups.ts: a server component that imports a
 * plain value from a client module does not get the value, it gets a client
 * reference proxy. `ROSTER_COLUMNS` lived in roster-table.tsx at first and
 * the page iterated it — which typechecked, built, and then threw
 * "ROSTER_COLUMNS is not iterable" on every request. Types may cross that
 * boundary freely, since they are erased; values may not.
 */

export interface RosterCell {
  value: number | null;
  /** From the KPI engine: PASS, WARNING, FAIL, or null with nothing measured. */
  status: string | null;
}

export interface RosterRow {
  employeeId: string;
  name: string;
  eid: string;
  /** How many of the columns shown are below target. The default sort key. */
  below: number;
  phoneHours: number | null;
  nonPhoneHours: number | null;
  /** Which skills made up those hours, for the sub-line's tooltip. */
  hoursNote: string | null;
  cells: Record<string, RosterCell>;
}

export type SortMode = "worst" | "alpha";

/** The columns, in the order the business reads them. */
export const ROSTER_COLUMNS: Array<{ code: string; label: string }> = [
  { code: "PRODUCTION_RATE", label: "PAR" },
  { code: "CASE_RATE", label: "Case Rate" },
  { code: "AHT", label: "AHT" },
  { code: "CPH", label: "CPH" },
  { code: "QUALITY", label: "Quality" },
  { code: "NPS", label: "NPS" },
  { code: "ATTENDANCE", label: "Attendance" },
  { code: "MBO", label: "MBO" },
];

/** Below target on this many measures and the whole row is shaded, matching team-agent-rows.tsx. */
export const SHADE_AT = 4;
