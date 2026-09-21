"use client";

import { useState, useTransition } from "react";
import { STAGES, meetsTarget, movement, type ProgressionRow, type StageCell } from "@/lib/ramp/progression";
import type { AgentProgression, StageDetail, TeamProgression } from "@/lib/queries/ramp-progression";
import { loadRampStageDetail, loadRampTeamAgents } from "./actions";
import { StagePanel } from "./stage-panel";

/**
 * Ramp progression: every team's new hires, stage by stage.
 *
 * Three levels, each fetched only when it is asked for. The team rows come
 * with the page; a team's agents arrive when the team is opened; what a
 * supervisor wrote arrives when a cell is clicked. That is not only about
 * speed — the whole answer for four hundred agents across ten stages is more
 * than a cached entry will hold, so the page is built to never need it all
 * at once.
 */

const HEAD = "px-2.5 py-2 text-[11px] font-semibold tracking-[0.06em] text-ink uppercase";
const CELL = "px-2.5 py-1.5 text-center text-xs tabular-nums";

export function ProgressionBoard({ teams }: { teams: TeamProgression[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [agents, setAgents] = useState<Record<string, AgentProgression[]>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loading, startLoading] = useTransition();
  const [panel, setPanel] = useState<{
    agent: AgentProgression;
    stage: number;
    detail: StageDetail | null;
  } | null>(null);

  function toggleTeam(name: string) {
    setOpen((current) => ({ ...current, [name]: !current[name] }));
    if (open[name] || agents[name] || loading) return;
    startLoading(async () => {
      const result = await loadRampTeamAgents(name);
      if (result.ok) setAgents((current) => ({ ...current, [name]: result.agents }));
      else setFailed((current) => ({ ...current, [name]: true }));
    });
  }

  function openPanel(agent: AgentProgression, stage: number) {
    // Shown at once with the figures it was opened from, then filled: what
    // the supervisor wrote is a second read, and the reader has already told
    // us which cell they meant.
    setPanel({ agent, stage, detail: null });
    startLoading(async () => {
      const result = await loadRampStageDetail({ employeeId: agent.employeeId, stage });
      setPanel((current) =>
        current && current.agent.employeeId === agent.employeeId && current.stage === stage
          ? { ...current, detail: result.ok ? result.detail : { week: null, items: [] } }
          : current,
      );
    });
  }

  if (teams.length === 0) {
    return (
      <p className="px-6 py-8 text-sm text-muted">
        No ramp has been recorded yet. Set a start date below and this fills in as weeks are imported.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-ink">
              <th className={`${HEAD} sticky left-0 z-10 bg-surface text-left`}>Team</th>
              {STAGES.map(({ stage, label }) => (
                <th key={stage} className={HEAD}>
                  {label}
                </th>
              ))}
              <th className={HEAD}>Movement</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <TeamRows
                key={team.supervisor}
                team={team}
                open={!!open[team.supervisor]}
                failed={!!failed[team.supervisor]}
                agents={agents[team.supervisor]}
                onToggle={() => toggleTeam(team.supervisor)}
                onCell={openPanel}
              />
            ))}
          </tbody>
        </table>
      </div>

      {panel && (
        <StagePanel
          agentName={panel.agent.employeeName}
          stageLabel={STAGES[panel.stage]?.label ?? ""}
          detail={panel.detail}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

function TeamRows({
  team,
  open,
  failed,
  agents,
  onToggle,
  onCell,
}: {
  team: TeamProgression;
  open: boolean;
  failed: boolean;
  agents: AgentProgression[] | undefined;
  onToggle: () => void;
  onCell: (agent: AgentProgression, stage: number) => void;
}) {
  return (
    <>
      <tr className="border-b-2 border-line bg-cream">
        <th colSpan={STAGES.length + 2} className="p-0 text-left">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-orange-brand-100"
          >
            <span
              aria-hidden="true"
              className={`inline-block w-[9px] text-xs text-muted transition-transform duration-[120ms] ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            <span className="text-[13px] font-bold text-ink">{team.supervisor}</span>
            <span className="text-[11px] text-muted">
              {team.agents} ramped · {team.rows.length} measure{team.rows.length === 1 ? "" : "s"}
            </span>
          </button>
        </th>
      </tr>

      {team.rows.map((row) => (
        <MeasureRow key={row.key} row={row} indent="pl-8" />
      ))}

      {open && failed && (
        <tr>
          <td colSpan={STAGES.length + 2} className="px-8 py-2 text-xs text-fail">
            Could not load this team&rsquo;s agents. The team figures above are still current.
          </td>
        </tr>
      )}

      {open &&
        agents?.map((agent) => (
          <AgentRows key={agent.employeeId} agent={agent} onCell={onCell} />
        ))}

      {open && !agents && !failed && (
        <tr>
          <td colSpan={STAGES.length + 2} className="px-8 py-2 text-xs text-muted">
            Loading agents…
          </td>
        </tr>
      )}
    </>
  );
}

function AgentRows({
  agent,
  onCell,
}: {
  agent: AgentProgression;
  onCell: (agent: AgentProgression, stage: number) => void;
}) {
  return (
    <>
      <tr className="border-b border-line">
        <td colSpan={STAGES.length + 2} className="px-12 py-1.5 text-[11px] font-semibold text-ink">
          {agent.employeeName} <span className="font-normal text-muted">{agent.eid}</span>
        </td>
      </tr>
      {agent.rows.map((row) => (
        <MeasureRow
          key={`${agent.employeeId}|${row.key}`}
          row={row}
          indent="pl-12"
          onCell={(stage) => onCell(agent, stage)}
        />
      ))}
    </>
  );
}

function MeasureRow({
  row,
  indent,
  onCell,
}: {
  row: ProgressionRow;
  indent: string;
  /** Only an agent's rows open the panel: a team average is nobody's plan. */
  onCell?: (stage: number) => void;
}) {
  const shift = movement(row.cells, row.lowerIsBetter);

  return (
    <tr className="border-b border-line last:border-b-0">
      <td className={`${indent} sticky left-0 z-10 bg-surface py-1.5 pr-2.5 text-xs text-ink`}>
        {row.label}
        <span className="ml-1.5 text-[10px] tracking-[0.06em] text-muted uppercase">
          {row.kind === "skill" ? "skill" : "kpi"}
        </span>
      </td>

      {STAGES.map(({ stage }) => (
        <Cell
          key={stage}
          cell={row.cells[stage]}
          lowerIsBetter={row.lowerIsBetter}
          onClick={onCell && row.cells[stage].value !== null ? () => onCell(stage) : undefined}
        />
      ))}

      <td className={CELL}>
        {shift === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={shift >= 0 ? "text-pass" : "text-fail"}>
            {shift > 0 ? "+" : ""}
            {round(shift)}
          </span>
        )}
      </td>
    </tr>
  );
}

function Cell({
  cell,
  lowerIsBetter,
  onClick,
}: {
  cell: StageCell;
  lowerIsBetter: boolean;
  onClick?: () => void;
}) {
  if (cell.value === null) {
    return (
      <td className={`${CELL} text-ink-faint`}>
        <span aria-label="not measured">—</span>
      </td>
    );
  }

  const met = meetsTarget(cell, lowerIsBetter);
  const tone = met === null ? "text-ink" : met ? "text-pass" : "text-fail";
  // A cell built from one agent-week is a figure, not an average; saying so
  // stops a reader reading a whole team into one person's week.
  const title = [
    cell.target !== null ? `Target ${round(cell.target)}` : null,
    `${cell.sample} agent-week${cell.sample === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span className={tone}>{round(cell.value)}</span>
      {cell.sample === 1 && <span className="ml-0.5 text-[9px] text-muted">·1</span>}
    </>
  );

  return (
    <td className={CELL} title={title}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="underline decoration-dotted underline-offset-4 transition hover:decoration-solid"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </td>
  );
}

/** Two decimals at most, and none where they would only be noise. */
function round(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2).replace(/\.00$/, "");
}
