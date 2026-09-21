import { STAGES, movement, type ProgressionRow } from "./progression";

/**
 * The progression grid as rows a spreadsheet can hold.
 *
 * One flat table rather than the nested one on screen: a team's own rows and
 * its agents' rows sit side by side, told apart by the Level column. Nesting
 * reads well in a browser where you can fold it, and badly in a spreadsheet
 * where you cannot — a flat table sorts, filters and pivots, which is what
 * anyone downloading this is about to do.
 *
 * Pure, so what the file contains can be tested without a database, a route
 * or a spreadsheet library.
 */

export interface ExportRow {
  supervisor: string;
  /** Empty for a team's own average; the agent's name for their rows. */
  agentName: string;
  eid: string;
  rows: ProgressionRow[];
}

export const EXPORT_HEADER: readonly string[] = [
  "Team",
  "Level",
  "Agent",
  "EID",
  "Measure",
  "Kind",
  "Direction",
  ...STAGES.map((s) => s.label),
  ...STAGES.map((s) => `${s.label} target`),
  ...STAGES.map((s) => `${s.label} agent-weeks`),
  "Movement",
];

/**
 * A value or a target as the sheet should hold it: a real number where there
 * is one, and an empty cell where there is not.
 *
 * Deliberately not a dash or a zero. A dash makes the column text and stops
 * it averaging; a zero is a measurement nobody took, and would drag every
 * total drawn from the file.
 */
function cell(value: number | null): number | "" {
  return value === null ? "" : Number(value.toFixed(4));
}

export function exportRows(
  groups: readonly ExportRow[],
): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [];

  for (const group of groups) {
    for (const row of group.rows) {
      out.push([
        group.supervisor,
        group.agentName === "" ? "Team" : "Agent",
        group.agentName,
        group.eid,
        row.label,
        row.kind,
        row.lowerIsBetter ? "lower is better" : "higher is better",
        ...STAGES.map(({ stage }) => cell(row.cells[stage]?.value ?? null)),
        ...STAGES.map(({ stage }) => cell(row.cells[stage]?.target ?? null)),
        ...STAGES.map(({ stage }) => row.cells[stage]?.sample ?? 0),
        cell(movement(row.cells, row.lowerIsBetter)),
      ]);
    }
  }

  return out;
}

/** `ramp-progression-2026-09-21`, with nothing in it a filesystem minds. */
export function exportFilename(today: string): string {
  return `ramp-progression-${today.replace(/[^0-9a-z-]/gi, "")}`;
}
