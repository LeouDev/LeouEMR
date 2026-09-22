import type { AgentWeekStanding } from "./week";

/**
 * The weekly audit requirement rolled up per team leader: how many audits
 * their active agents owed in the week, how many were filed, and the share
 * — the Audit completion chart's rows. Pure, so the roll-up is pinned by
 * tests rather than read off a chart.
 */

export interface LeaderCompletion {
  leader: string;
  /** Agents who owed audits in the week. */
  activeAgents: number;
  required: number;
  completed: number;
  /** Whole percent of required, not capped: a team that filed extra reads above 100. */
  completionPct: number;
}

export const UNASSIGNED_LEADER = "Unassigned";

export function completionByLeader(
  rows: ReadonlyArray<{
    supervisorName: string | null;
    standing: AgentWeekStanding;
    required: number;
    completed: number;
  }>,
): LeaderCompletion[] {
  const byLeader = new Map<string, LeaderCompletion>();
  for (const row of rows) {
    const leader = row.supervisorName ?? UNASSIGNED_LEADER;
    const entry = byLeader.get(leader) ?? { leader, activeAgents: 0, required: 0, completed: 0, completionPct: 0 };
    if (row.standing === "active") entry.activeAgents += 1;
    entry.required += row.required;
    entry.completed += row.completed;
    byLeader.set(leader, entry);
  }

  // A leader whose whole team owed nothing that week (all on leave, all
  // separated) has no completion to show; a bar for them would be a
  // division by zero dressed up as a number.
  return [...byLeader.values()]
    .filter((entry) => entry.required > 0)
    .map((entry) => ({ ...entry, completionPct: Math.round((entry.completed / entry.required) * 100) }))
    .sort((a, b) => a.leader.localeCompare(b.leader));
}
