import type { MboRow } from "@/lib/queries/mbo";
import { groupByLeader, matchesMboFilter, type MboFilter } from "./teams";

/**
 * The MBO page as rows a spreadsheet can hold: one line per agent, in the
 * page's team-leader bands and order, with the gate values behind the
 * score. Pure, so the file's contents are tested without a route.
 */

export const MBO_EXPORT_HEADER: readonly string[] = [
  "Team leader",
  "Employee",
  "EID",
  "MBO %",
  "Result",
  "Production rate",
  "DPU %",
  "DPO %",
  "Gates missed",
  "Team pass rate %",
];

const RESULT: Record<"true" | "false" | "null", string> = { true: "Passing", false: "Failing", null: "No score" };

/** A figure to a fixed number of decimals, as a number the sheet can sum; blank when unmeasured. */
function fixed(value: number | null, digits: number): number | string {
  return value === null ? "" : Number(value.toFixed(digits));
}

export function mboExportRows(rows: readonly MboRow[], filter: MboFilter): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [];
  for (const team of groupByLeader(rows)) {
    for (const row of team.rows) {
      if (!matchesMboFilter(row, filter)) continue;
      out.push([
        team.leader,
        row.name,
        row.eid,
        fixed(row.mbo, 1),
        RESULT[String(row.passing) as "true" | "false" | "null"],
        fixed(row.productionRate, 3),
        fixed(row.dpu, 1),
        fixed(row.dpo, 1),
        row.failedGates.join(", "),
        fixed(team.passRate, 1),
      ]);
    }
  }
  return out;
}

/** `mbo-2026-09-01-failing`: the period's first day and which tab was exported. */
export function mboExportFilename(periodStart: string, filter: MboFilter): string {
  const suffix: Record<MboFilter, string> = { all: "everyone", pass: "passing", fail: "failing", unscored: "no-score" };
  return `mbo-${periodStart}-${suffix[filter]}`;
}
