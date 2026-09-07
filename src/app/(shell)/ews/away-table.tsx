"use client";

import Link from "next/link";
import { useState } from "react";
import type { EwsRow } from "@/lib/queries/ews";
import { formatWeek } from "@/components/ui";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

const LABELS: Record<string, string> = {
  black: "Resignation / termination",
  absconding: "Absconding",
  loa: "Leave of absence",
  maternity: "Maternity",
};

/**
 * Which tags belong to each view. Absconding sits with the exits rather than
 * the leaves: someone who stopped turning up without notice is not expected
 * back, and grouping them with maternity would misread the situation.
 */
const GROUPS = {
  all: null,
  separated: ["black", "absconding"],
  leave: ["loa", "maternity"],
} as const;

type View = keyof typeof GROUPS;

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "all", label: "All" },
  { value: "separated", label: "Separated" },
  { value: "leave", label: "On leave" },
];

export function AwayTable({ rows }: { rows: EwsRow[] }) {
  const [view, setView] = useState<View>("all");
  const codes = GROUPS[view];
  const visible = codes ? rows.filter((r) => codes.includes(r.attrition as never)) : rows;

  const count = (v: View) => {
    const c = GROUPS[v];
    return c ? rows.filter((r) => c.includes(r.attrition as never)).length : rows.length;
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line px-6 py-3">
        <p className="text-sm text-muted">
          {count("separated")} separated · {count("leave")} on leave
        </p>
        <div className="flex border-2 border-ink">
          {VIEWS.map((option, i) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              className={`cursor-pointer px-3 py-1.5 text-xs font-semibold ${
                i > 0 ? "border-l-2 border-ink" : ""
              } ${
                view === option.value
                  ? "bg-ink text-white"
                  : "bg-surface text-ink hover:bg-orange-brand-100"
              }`}
            >
              {option.label} ({count(option.value)})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted">
          Nobody in your span is {view === "leave" ? "on leave" : view === "separated" ? "separated" : "tagged"}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${HEAD} px-6 text-left`}>Agent</th>
                <th className={`${HEAD} text-left`}>Status</th>
                <th className={`${HEAD} text-left`}>Supervisor</th>
                <th className={`${HEAD} text-left`}>Recorded</th>
                <th className={`${HEAD} px-6 text-left`}>Observations</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.employeeId} className="border-b-2 border-line last:border-0 hover:bg-cream">
                  <td className="px-6 py-3">
                    <Link
                      href={`/employees/${row.employeeId}`}
                      prefetch={false}
                      className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                    >
                      {row.employeeName}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold ${
                        row.attrition === "black" || row.attrition === "absconding"
                          ? "bg-fail-bg text-fail"
                          : "bg-warn-bg text-warn"
                      }`}
                    >
                      {LABELS[row.attrition ?? ""] ?? row.attrition}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted">{row.supervisorName ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {row.week ? formatWeek(row.week) : "—"}
                    {row.assessedByName && <span className="block">{row.assessedByName}</span>}
                  </td>
                  <td className="px-6 py-3 text-xs text-muted">{row.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
