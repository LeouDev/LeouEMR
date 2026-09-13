/**
 * The agent picker on the New Audit page: a search box over the roster
 * rather than a dropdown. A team leader's list is a scroll; a support
 * role's list is the whole floor, and a dropdown of six hundred names is
 * no way to find one.
 */

export interface AgentOption {
  id: string;
  /** The name as the roster spells it. */
  name: string;
  eid: string;
  supervisorName: string | null;
}

/** Matches shown at once; more than this and the reader types another letter. */
export const MAX_MATCHES = 8;

/** Case, accents and the punctuation names carry all fold away. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .toLowerCase();
}

/**
 * Every space-separated term must appear in the name, the employee ID or
 * the team leader's name. Names that begin with what was typed come
 * first, so "cru" lists Cruz before anyone whose team leader is Cruz;
 * within a rank the roster's alphabetical order holds. An empty query
 * shows the first few, so a short list needs no typing at all.
 */
export function matchAgents(agents: readonly AgentOption[], query: string, limit = MAX_MATCHES): AgentOption[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return agents.slice(0, limit);
  const leading: AgentOption[] = [];
  const rest: AgentOption[] = [];
  for (const agent of agents) {
    const name = fold(agent.name);
    const haystack = `${name} ${fold(agent.eid)} ${fold(agent.supervisorName ?? "")}`;
    if (!terms.every((term) => haystack.includes(term))) continue;
    (name.startsWith(terms[0]) ? leading : rest).push(agent);
  }
  return [...leading, ...rest].slice(0, limit);
}

/** How many of the roster match, for the "showing n of m" line. */
export function countMatches(agents: readonly AgentOption[], query: string): number {
  return matchAgents(agents, query, Number.POSITIVE_INFINITY).length;
}
