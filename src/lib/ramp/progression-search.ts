/**
 * The search box over the ramp progression: a supervisor's name finds
 * their team whole; an agent's name or employee ID finds their team with
 * only the agents that matched. Pure, so the matching rules are pinned by
 * tests rather than tried in the browser.
 */

export interface SearchableTeam {
  supervisor: string;
  roster: ReadonlyArray<{ employeeId: string; employeeName: string; eid: string }>;
}

export interface TeamMatch<T extends SearchableTeam> {
  team: T;
  /** The agents that matched, or null when the whole team did (or nothing was typed). */
  agentIds: ReadonlySet<string> | null;
}

/** Case, accents and the punctuation names carry all fold away. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .toLowerCase();
}

function matches(haystack: string, terms: readonly string[]): boolean {
  const folded = fold(haystack);
  return terms.every((term) => folded.includes(term));
}

/**
 * Every space-separated term must appear in the supervisor's name, or in
 * one agent's name or employee ID. A team is listed when either holds;
 * with nothing typed every team is listed whole.
 */
export function filterTeams<T extends SearchableTeam>(teams: readonly T[], query: string): TeamMatch<T>[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return teams.map((team) => ({ team, agentIds: null }));

  const out: TeamMatch<T>[] = [];
  for (const team of teams) {
    if (matches(team.supervisor, terms)) {
      out.push({ team, agentIds: null });
      continue;
    }
    const agentIds = new Set(
      team.roster
        .filter((agent) => matches(`${agent.employeeName} ${agent.eid}`, terms))
        .map((agent) => agent.employeeId),
    );
    if (agentIds.size > 0) out.push({ team, agentIds });
  }
  return out;
}
