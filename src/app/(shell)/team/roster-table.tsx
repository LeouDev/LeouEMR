"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatMetric, metricTone } from "@/components/ui";

/**
 * One agent's row and one team's strip, already reduced to plain data on the
 * server.
 *
 * Nothing but strings, numbers and plain objects crosses into this file, and
 * nothing here is imported back the other way — a server module that reads a
 * value out of a client one gets a reference proxy instead of the value,
 * which is how the dashboard went down once (see kpi-groups.ts).
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

/**
 * PAR and MBO read as a verdict rather than a level.
 *
 * Both are gates the business either clears or does not — PAR at 2.99, MBO at
 * every gate met — so a warning band on them would invent a middle where the
 * rule has none, and would disagree with the pass rates in the strip above
 * computed off the same gate.
 */
const VERDICT_COLUMNS = new Set(["PRODUCTION_RATE", "MBO"]);

/** Below target on this many measures and the whole row is shaded, matching team-agent-rows.tsx. */
const SHADE_AT = 4;

export function RosterTable({
  rows,
  initialSort,
}: {
  rows: RosterRow[];
  initialSort: SortMode;
}) {
  // Sort is the one control that stays client-side: it reorders what is
  // already on screen rather than asking a different question of the server,
  // so round-tripping it would cost a navigation for nothing.
  const [sort, setSort] = useState<SortMode>(initialSort);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        sort === "worst" ? b.below - a.below || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
      ),
    [rows, sort],
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-baseline justify-end gap-2">
        <label
          htmlFor="roster-sort"
          className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase"
        >
          Sort
        </label>
        <select
          id="roster-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
          className="border-2 border-ink bg-surface px-2.5 py-2 text-[13px] font-bold text-ink outline-none"
        >
          <option value="worst">Worst first</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>

      <div className="overflow-x-auto border-2 border-ink bg-surface">
        <table className="w-full min-w-[1020px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className="px-4 py-3 text-left text-[11px] font-bold tracking-[0.08em] text-ink uppercase">
                Agent
              </th>
              <th className="px-2.5 py-3 text-right text-[11px] font-bold tracking-[0.08em] text-ink uppercase">
                Below
              </th>
              {ROSTER_COLUMNS.map((column) => (
                <th
                  key={column.code}
                  className="px-2.5 py-3 text-right text-[11px] font-bold tracking-[0.08em] text-ink uppercase last:pr-4"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.employeeId}
                className={`border-b-2 border-line last:border-0 ${
                  row.below >= SHADE_AT ? "bg-fail-bg" : "hover:bg-cream"
                }`}
              >
                <td className="px-4 py-3">
                  <div>
                    <Link
                      href={`/employees/${row.employeeId}`}
                      prefetch={false}
                      className="font-bold text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="ml-1.5 font-mono text-[11px] text-muted">{row.eid}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted" title={row.hoursNote ?? undefined}>
                    {row.phoneHours === null && row.nonPhoneHours === null ? (
                      "No productive hours this period"
                    ) : (
                      <>
                        Phone Hours: <Hours value={row.phoneHours} /> · Non-Phone Hours:{" "}
                        <Hours value={row.nonPhoneHours} />
                      </>
                    )}
                  </div>
                </td>
                <td
                  className={`px-2.5 py-3 text-right font-mono font-extrabold tabular-nums ${
                    row.below > 0 ? "text-fail" : "text-ink-faint"
                  }`}
                >
                  {row.below || "—"}
                </td>
                {ROSTER_COLUMNS.map((column) => (
                  <td
                    key={column.code}
                    className="px-2.5 py-3 text-right font-mono font-bold tabular-nums last:pr-4"
                  >
                    <Cell cell={row.cells[column.code]} code={column.code} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3.5 text-xs text-muted">
        Sorted {sort === "worst" ? "worst first" : "alphabetically"} · row shading marks an agent
        below target on {SHADE_AT} or more measures · click a name for their full record.
      </p>
    </>
  );
}

function Hours({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return <strong className="font-bold text-ink">{value.toFixed(1)}h</strong>;
}

/**
 * One measure for one agent.
 *
 * The tone is the KPI engine's own evaluated status, never a ratio
 * recomputed here — the engine holds the thresholds, ramp targets and
 * per-employee CPH/AHT targets, none of which a client component can see.
 * PAR and MBO read as Pass / Fail for the reason above VERDICT_COLUMNS.
 */
function Cell({ cell, code }: { cell: RosterCell | undefined; code: string }) {
  if (!cell || cell.value === null) return <span className="text-ink-faint">—</span>;
  if (VERDICT_COLUMNS.has(code)) {
    const passed = cell.status === "PASS";
    return (
      <span className={`font-extrabold ${passed ? "text-pass" : "text-fail"}`}>
        {passed ? "Pass" : "Fail"}
      </span>
    );
  }
  return <span className={metricTone(cell.status)}>{formatMetric(cell.value, code)}</span>;
}
