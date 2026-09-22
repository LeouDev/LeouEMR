"use client";

import Link from "next/link";
import { useState } from "react";
import type { MboRow } from "@/lib/queries/mbo";
import type { MboTeam } from "@/lib/mbo/teams";

/**
 * The MBO roster as one band per team leader, each opening onto its
 * agents. The band carries the team's whole-roster figures — headcount,
 * pass rate, the mean of each gate and how many agents missed which — so
 * a manager reads the teams first and opens the one to work through; the
 * agent rows underneath are the ones the page's status tab keeps (a team
 * with none of them is left off the page).
 *
 * A single team (a supervisor's own) opens by itself: a closed band with
 * nothing beside it would be a click for no reason.
 */

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";
const NUM = "px-3 py-2.5 font-mono tabular-nums";

export interface MboTeamView {
  team: MboTeam;
  /** The agents the page's tab keeps; the band's figures still cover the whole team. */
  rows: MboRow[];
}

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function rate(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

export function MboTeamTable({ teams }: { teams: MboTeamView[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    teams.length === 1 ? { [teams[0].team.leader]: true } : {},
  );
  const allOpen = teams.every(({ team }) => open[team.leader]);

  function toggle(leader: string) {
    setOpen((current) => ({ ...current, [leader]: !current[leader] }));
  }

  function toggleAll() {
    setOpen(allOpen ? {} : Object.fromEntries(teams.map(({ team }) => [team.leader, true])));
  }

  return (
    <>
      {teams.length > 1 && (
        <div className="flex items-center justify-end border-b-2 border-line px-6 py-2">
          <button
            type="button"
            onClick={toggleAll}
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
              <th className={`${HEAD} px-6`}>Team leader · employee</th>
              <th className={HEAD}>MBO</th>
              <th className={HEAD}>Production rate</th>
              <th className={HEAD}>DPU</th>
              <th className={HEAD}>DPO</th>
              <th className={`${HEAD} px-6`}>Gates missed</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(({ team, rows }) => (
              <TeamRows
                key={team.leader}
                team={team}
                rows={rows}
                open={!!open[team.leader]}
                onToggle={() => toggle(team.leader)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamRows({
  team,
  rows,
  open,
  onToggle,
}: {
  team: MboTeam;
  rows: MboRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const summary = [
    `${team.agents} agent${team.agents === 1 ? "" : "s"}`,
    `${team.passing} passing`,
    `${team.failing} failing`,
    ...(team.unscored > 0 ? [`${team.unscored} no score`] : []),
  ].join(" · ");
  const scored = team.passing + team.failing;

  return (
    <>
      <tr className="border-b-2 border-line bg-cream">
        <th scope="row" className="p-0 text-left font-normal">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-full items-center gap-2.5 px-6 py-2.5 text-left transition hover:bg-orange-brand-100"
          >
            <span
              aria-hidden="true"
              className={`inline-block w-[9px] text-xs text-muted transition-transform duration-[120ms] ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            <span className="text-[13px] font-bold text-ink">{team.leader}</span>
            <span className="text-[11px] text-muted">{summary}</span>
          </button>
        </th>
        <td className={`${NUM} font-semibold text-ink`} title={scored === 0 ? "Nobody scored" : `${team.passing} of ${scored} scored passing`}>
          {team.passRate === null ? "—" : `${team.passRate.toFixed(0)}% pass`}
        </td>
        <td className={`${NUM} text-muted`} title="Team average">{rate(team.avgProductionRate)}</td>
        <td className={`${NUM} text-muted`} title="Team average">{pct(team.avgDpu)}</td>
        <td className={`${NUM} text-muted`} title="Team average">{pct(team.avgDpo)}</td>
        <td className="px-6 py-2.5 text-xs">
          {team.gateMisses.length === 0 ? (
            <span className="text-muted">{scored === 0 ? "no data" : "—"}</span>
          ) : (
            <span className="font-semibold text-fail">
              {team.gateMisses.map((m) => `${m.gate} ×${m.count}`).join(" · ")}
            </span>
          )}
        </td>
      </tr>

      {open &&
        rows.map((row) => (
          <tr key={row.employeeId} className="border-b border-line hover:bg-cream">
            <td className="px-6 py-2.5">
              <Link
                href={`/employees/${row.employeeId}`}
                prefetch={false}
                className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
              >
                {row.name}
              </Link>
              <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
            </td>
            <td
              className={`${NUM} font-semibold ${
                row.passing === null ? "text-muted" : row.passing ? "text-pass" : "text-fail"
              }`}
            >
              {pct(row.mbo, 0)}
            </td>
            <td className={`${NUM} text-muted`}>{rate(row.productionRate)}</td>
            <td className={`${NUM} text-muted`}>{pct(row.dpu)}</td>
            <td className={`${NUM} text-muted`}>{pct(row.dpo)}</td>
            <td className="px-6 py-2.5 text-xs">
              {row.failedGates.length === 0 ? (
                <span className="text-muted">{row.passing === null ? "no data" : "—"}</span>
              ) : (
                <span className="bg-fail-bg px-2 py-1 font-semibold text-fail">{row.failedGates.join(", ")}</span>
              )}
            </td>
          </tr>
        ))}
    </>
  );
}
