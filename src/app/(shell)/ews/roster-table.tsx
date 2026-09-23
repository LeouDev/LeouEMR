"use client";

import Link from "next/link";
import { useState } from "react";
import { EwsRiskBadge } from "@/components/ui";
import { filterRoster, relativeTime, type EwsRosterRow } from "@/lib/ews/roster";
import { AssessmentDialog } from "./assessment-dialog";
import { HEAD, Pill } from "./ews-tabs";

/**
 * The My Team roster: a search over it, the table worst first, and the
 * edit form behind each row for a viewer who records. The rows arrive
 * scored from the server; the search narrows them here, in the browser,
 * because a roster is a few hundred names at most and a round trip per
 * keystroke would be the slower experience.
 */
export function RosterTable({
  rows,
  indicators,
  week,
  canEdit,
  showTeam,
  now,
  exportHref,
}: {
  rows: EwsRosterRow[];
  indicators: Array<{ code: string; label: string }>;
  week: string;
  canEdit: boolean;
  showTeam: boolean;
  /** ISO timestamp the page rendered at, so "3 days ago" is the same on server and client. */
  now: string;
  exportHref: string;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EwsRosterRow | null>(null);
  const visible = filterRoster(rows, query);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Search by name, ID or position</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, ID or position"
            className="w-full border-2 border-ink bg-surface px-3 py-2 text-[13px] text-ink outline-none"
          />
        </label>
        {/* A plain link, not a button: a download is a navigation. */}
        <a href={exportHref} className="border-2 border-ink bg-surface px-4 py-2 text-xs font-bold text-ink transition hover:border-orange-brand hover:text-orange-brand">
          Export CSV
        </a>
      </div>

      <div className="overflow-x-auto border-2 border-ink bg-surface">
        <table className="w-full min-w-[1080px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className={`${HEAD} px-4`}>Employee</th>
              <th className={HEAD}>Position</th>
              {showTeam && <th className={HEAD}>Team</th>}
              <th className={HEAD}>Risk</th>
              <th className={HEAD}>Vs last week</th>
              <th className={HEAD}>Flags</th>
              <th className={HEAD}>Updated</th>
              <th className={HEAD}>Remarks</th>
              {canEdit && <th className={`${HEAD} px-4 text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-muted">
                  {query.trim() ? "Nobody matches that search." : "Nobody in scope."}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr key={row.employeeId} className="border-b-2 border-line last:border-0 hover:bg-cream/60">
                <td className="px-4 py-2.5 align-top text-left">
                  <Link href={`/employees/${row.employeeId}`} prefetch={false} className="font-semibold text-ink underline-offset-4 hover:text-orange-brand hover:underline">
                    {row.name}
                  </Link>
                  <div className="font-mono text-[11px] text-ink-faint">{row.eid}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-left text-muted">{row.position ?? "—"}</td>
                {showTeam && <td className="px-3 py-2.5 align-top text-left text-muted">{row.supervisorName ?? "—"}</td>}
                <td className="px-3 py-2.5 align-top text-left">
                  <EwsRiskBadge riskLevel={row.riskLevel} score={row.score} />
                </td>
                <td className="px-3 py-2.5 align-top text-left font-mono text-xs">
                  {row.delta === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : row.delta > 0 ? (
                    <span className="font-bold text-fail">▲ +{row.delta}</span>
                  ) : row.delta < 0 ? (
                    <span className="font-bold text-pass">▼ {row.delta}</span>
                  ) : (
                    <span className="text-ink-faint">— No change</span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top text-left text-xs">
                  {row.flag === "leave" ? <Pill tone="warn">On leave</Pill> : <span className="text-ink-faint">—</span>}
                </td>
                <td className="px-3 py-2.5 align-top text-left text-xs text-ink-faint">
                  {row.latest ? relativeTime(row.latest.updatedAt, now) : "Not yet assessed"}
                </td>
                <td className="max-w-[200px] px-3 py-2.5 align-top text-left text-xs text-muted">
                  <span className="line-clamp-2" title={row.latest?.notes ?? undefined}>
                    {row.latest?.notes || "—"}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5 text-right align-top whitespace-nowrap">
                    <button type="button" onClick={() => setEditing(row)} className="cursor-pointer px-1.5 py-1 text-xs font-bold text-orange-brand hover:underline">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3.5 text-xs text-muted">Sorted worst first — Critical, At risk, Watch, then Stable. Click a name to open the full record.</p>

      {editing && <AssessmentDialog row={editing} indicators={indicators} week={week} onClose={() => setEditing(null)} />}
    </>
  );
}
