"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EWS_ATTRITION_LABELS } from "@/lib/ews/engine";
import { returnOverdue, type ExitRow, type LeaveRegisterRow as LeaveRow } from "@/lib/ews/export";
import { describeActionError } from "@/lib/ui/action-error";
import { restoreFromAttrition } from "../actions";
import { HEAD, Pill } from "../ews-tabs";

const NAME = "px-4 py-2.5 text-left font-semibold text-ink";
const CELL = "px-2.5 py-2.5 text-left text-muted";

function Name({ id, name, eid }: { id: string; name: string; eid: string }) {
  return (
    <>
      <Link href={`/employees/${id}`} prefetch={false} className="underline-offset-4 hover:text-orange-brand hover:underline">
        {name}
      </Link>{" "}
      <span className="font-mono text-[11px] font-normal text-ink-faint">{eid}</span>
    </>
  );
}

/** The exits table with Restore for a viewer who records, and the leave register under it. */
export function AttritionTables({
  exits,
  leaves,
  canEdit,
  showTeam,
  today,
  exportHref,
}: {
  exits: ExitRow[];
  leaves: LeaveRow[];
  canEdit: boolean;
  showTeam: boolean;
  today: string;
  exportHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(row: ExitRow) {
    if (!window.confirm(`Restore ${row.name} to the active roster? The attrition tag is cleared and they return to My Team.`)) return;
    setBusy(row.employeeId);
    setError(null);
    let result;
    try {
      result = await restoreFromAttrition({ employeeId: row.employeeId });
    } catch (cause) {
      setError(describeActionError(cause));
      setBusy(null);
      return;
    }
    setBusy(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
          {error}
        </p>
      )}

      <div className="mb-7 overflow-x-auto border-2 border-ink bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className={`${HEAD} px-4`}>Employee</th>
              <th className={HEAD}>Position</th>
              {showTeam && <th className={HEAD}>Team</th>}
              <th className={HEAD}>Reason</th>
              <th className={HEAD}>Date</th>
              {canEdit && <th className={`${HEAD} px-4`} aria-label="Restore" />}
            </tr>
          </thead>
          <tbody>
            {exits.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                  No confirmed exits in this view.
                </td>
              </tr>
            )}
            {exits.map((row) => (
              <tr key={row.employeeId} className="border-b-2 border-line last:border-0">
                <td className={NAME}>
                  <Name id={row.employeeId} name={row.name} eid={row.eid} />
                </td>
                <td className={CELL}>{row.position ?? "—"}</td>
                {showTeam && <td className={CELL}>{row.supervisorName ?? "—"}</td>}
                <td className="px-2.5 py-2.5 text-left">
                  <Pill tone={row.attrition === "black" ? "ink" : "fail"}>{EWS_ATTRITION_LABELS[row.attrition]}</Pill>
                </td>
                <td className={`${CELL} font-mono`}>{row.date ?? "—"}</td>
                {canEdit && (
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => restore(row)}
                      className="cursor-pointer text-xs font-bold text-orange-brand hover:underline disabled:opacity-60"
                    >
                      {busy === row.employeeId ? "Restoring…" : "Restore"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border-2 border-ink bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-4 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold text-ink">Leave &amp; Absence Register</h2>
            <p className="mt-1 text-xs text-muted">LOA and maternity — away and expected back, kept on the roster and listed here separately</p>
          </div>
          <a href={exportHref} className="border-2 border-ink bg-surface px-3.5 py-2 text-xs font-bold text-ink transition hover:border-orange-brand hover:text-orange-brand">
            Export CSV
          </a>
        </div>
        <table className="w-full min-w-[800px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className={`${HEAD} px-4`}>Employee</th>
              {showTeam && <th className={HEAD}>Team</th>}
              <th className={HEAD}>Type</th>
              <th className={HEAD}>Started</th>
              <th className={HEAD}>Expected return</th>
              <th className={`${HEAD} px-4`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {leaves.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                  Nobody in this view is on leave.
                </td>
              </tr>
            )}
            {leaves.map((row) => (
              <tr key={row.employeeId} className="border-b-2 border-line last:border-0">
                <td className={NAME}>
                  <Name id={row.employeeId} name={row.name} eid={row.eid} />
                </td>
                {showTeam && <td className={CELL}>{row.supervisorName ?? "—"}</td>}
                <td className="px-2.5 py-2.5 text-left">
                  <Pill tone="warn">{EWS_ATTRITION_LABELS[row.attrition]}</Pill>
                </td>
                <td className={`${CELL} font-mono`}>{row.started ?? "—"}</td>
                <td className={`${CELL} font-mono`}>{row.expectedReturn ?? "—"}</td>
                <td className="px-4 py-2.5 text-left">
                  {returnOverdue(row, today) ? <Pill tone="fail">Return overdue</Pill> : <span className="text-xs text-ink-faint">On leave</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
