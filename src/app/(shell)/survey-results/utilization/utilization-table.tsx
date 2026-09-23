"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/ews/roster";
import type { UtilizationBand } from "@/lib/utilization/report";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";
const NUM = "px-3 py-2.5 font-mono tabular-nums";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Team leader",
  agent: "Agent",
  trainer: "Trainer",
  sme: "SME",
};

/**
 * One band per team (or manager) that opens onto its accounts: how many,
 * how many were active, the mean active days and the EOD reports on the
 * band; each account's own days, last visit and reports underneath.
 */
export function UtilizationTable({ bands, days, now }: { bands: UtilizationBand[]; days: number; now: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (bands.length === 1 ? { [bands[0].key]: true } : {}));
  const allOpen = bands.every((b) => open[b.key]);

  return (
    <>
      {bands.length > 1 && (
        <div className="flex items-center justify-end border-b-2 border-line px-6 py-2">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? {} : Object.fromEntries(bands.map((b) => [b.key, true])))}
            className="text-xs font-semibold text-muted underline-offset-4 transition hover:text-orange-brand hover:underline"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-cream">
              <th className={`${HEAD} px-6`}>Team · account</th>
              <th className={HEAD}>Accounts</th>
              <th className={HEAD}>Active</th>
              <th className={HEAD}>Active days</th>
              <th className={HEAD}>EOD sent</th>
              <th className={`${HEAD} px-6`}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <BandRows key={band.key} band={band} days={days} now={now} open={!!open[band.key]} onToggle={() => setOpen((c) => ({ ...c, [band.key]: !c[band.key] }))} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BandRows({ band, days, now, open, onToggle }: { band: UtilizationBand; days: number; now: string; open: boolean; onToggle: () => void }) {
  const lastSeen = band.members.map((m) => m.lastSeen).filter((v): v is string => v !== null).sort().pop() ?? null;
  return (
    <>
      <tr className="border-b-2 border-line bg-cream">
        <th scope="row" className="p-0 text-left font-normal">
          <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2.5 px-6 py-2.5 text-left transition hover:bg-orange-brand-100">
            <span aria-hidden="true" className={`inline-block w-[9px] text-xs text-muted transition-transform duration-[120ms] ${open ? "rotate-90" : ""}`}>
              ▸
            </span>
            <span className="text-[13px] font-bold text-ink">{band.label}</span>
            <span className="text-[11px] text-muted">
              {band.activeRate === null ? "no accounts" : `${band.activeRate}% active`}
            </span>
          </button>
        </th>
        <td className={`${NUM} text-ink`}>{band.accounts}</td>
        <td className={`${NUM} font-semibold ${band.active === band.accounts && band.accounts > 0 ? "text-pass" : band.active === 0 ? "text-fail" : "text-ink"}`}>{band.active}</td>
        <td className={`${NUM} text-muted`} title={`Mean active days per account, of ${days}`}>
          {band.avgActiveDays} <span className="text-[11px]">of {days}</span>
        </td>
        <td className={`${NUM} text-ink`}>{band.eodSent}</td>
        <td className="px-6 py-2.5 text-xs text-muted">{lastSeen ? relativeTime(lastSeen, now) : "—"}</td>
      </tr>
      {open &&
        band.members.map((m) => (
          <tr key={m.userId} className="border-b border-line hover:bg-cream">
            <td className="px-6 py-2.5">
              <span className="font-medium text-ink">{m.name}</span>
              <span className="ml-2 text-xs text-muted">{ROLE_LABELS[m.role] ?? m.role}</span>
            </td>
            <td className={`${NUM} text-muted`}>—</td>
            <td className={`${NUM} ${m.activeDays > 0 ? "text-pass" : "text-fail"}`}>{m.activeDays > 0 ? "Yes" : "No"}</td>
            <td className={`${NUM} text-ink`}>{m.activeDays}</td>
            <td className={`${NUM} text-ink`}>{m.eodSent}</td>
            <td className="px-6 py-2.5 text-xs text-muted">{m.lastSeen ? relativeTime(m.lastSeen, now) : "Never"}</td>
          </tr>
        ))}
    </>
  );
}
