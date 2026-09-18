import { SUSTAINED_WEEKS } from "@/lib/development/sustained";
import { isSupportRole } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { OPEN_STATUSES, getActionItems } from "./performance";
import type { ActionItemListRow } from "./performance";

// Re-exported from its own module so a client component can have the
// number without dragging this one (and the database) into the browser —
// see lib/development/sustained.ts.
export { SUSTAINED_WEEKS } from "@/lib/development/sustained";

/**
 * Who the board is for. A leader reads what they owe, an agent reads whose
 * move it is, and a trainer or SME reads where a team leader has asked for
 * their help — the same rows, three different questions.
 */
export type BoardReader = "leader" | "agent" | "support";

export function boardReaderFor(user: CurrentUser): BoardReader {
  if (user.role === "agent") return "agent";
  return isSupportRole(user) ? "support" : "leader";
}

export interface DevelopmentRow {
  employeeId: string;
  employeeName: string;
  /** The team leader as the roster records them; the support queue groups by it. */
  supervisorName: string | null;
  /** The manager above that leader, and the site, for the admin/manager roster's grouping. */
  managerName: string | null;
  site: string | null;
  items: ActionItemListRow[];
  openItems: number;
  /** Items with no root cause recorded yet — the first thing a supervisor owes. */
  missingRca: number;
  /** Items with an RCA but no action plan. */
  missingPlan: number;
  awaitingAcknowledgement: number;
  /** Items whose plan asks for training. */
  needsTraining: number;
  /** Items whose plan asks for coaching. */
  needsCoaching: number;
  /** Items past acknowledgement and counting weeks. */
  monitoring: number;
  /** Best progress across their open items, in weeks toward sustained. */
  bestProgress: number;
  /** The KPIs currently in development for this person, alphabetically. */
  kpis: string[];
  /** What this person needs next, as one phrase. */
  nextStep: string;
  /** Lower sorts first on a leader's board: the more blocked on the supervisor, the higher up. */
  urgency: number;
}

/**
 * A team leader's own row on the roster: their agents, and what the leader
 * owes across them.
 */
export interface RosterTeamLead {
  /** The leader's name, which is also what the board groups by. */
  name: string;
  site: string | null;
  headcount: number;
  openItems: number;
  missingRca: number;
  missingPlan: number;
  awaitingAcknowledgement: number;
  needsTraining: number;
  needsCoaching: number;
  /** People, not items — the chip reads "3 nearing close" about three agents. */
  nearingClose: number;
  /** The KPI most of this team's items are about, with how many. */
  topKpi: { name: string; count: number } | null;
  agents: DevelopmentRow[];
}

export interface RosterManager {
  name: string;
  teamLeadCount: number;
  headcount: number;
  teamLeads: RosterTeamLead[];
}

/** Where somebody lands when the roster has not recorded who they report to. */
export const NO_TEAM_LEAD = "No team leader on record";
export const NO_MANAGER = "No manager on record";

/** Most owed first: the leader with unwritten root causes before one only monitoring. */
function byMostOwed(a: RosterTeamLead, b: RosterTeamLead): number {
  return (
    b.missingRca - a.missingRca ||
    b.missingPlan - a.missingPlan ||
    b.awaitingAcknowledgement - a.awaitingAcknowledgement ||
    b.openItems - a.openItems ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The KPI this team's items are mostly about.
 *
 * Counted over items rather than people, so someone with the same KPI open
 * twice counts twice — that is what makes it the team's theme. Ties break
 * alphabetically so the label does not change between two equal KPIs from
 * one page load to the next.
 */
function topKpiOf(agents: DevelopmentRow[]): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    for (const item of agent.items) counts.set(item.kpiName, (counts.get(item.kpiName) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.length ? { name: ranked[0][0], count: ranked[0][1] } : null;
}

/**
 * Turns the flat board into the roster an admin or a manager reads:
 * manager, then team leader, then agent.
 *
 * A leader with a hundred and forty people in development cannot read them
 * as one list of names — the flat table is the right shape for a supervisor
 * with eight, and the wrong one for a span. Grouping puts the question
 * "which of my team leaders is behind on this" in front of the answer.
 *
 * Nobody is dropped for having a gap in the roster. An agent whose
 * supervisor or manager the import never recorded is grouped under a named
 * bucket instead of vanishing from a board that exists to make sure nobody
 * goes unnoticed — the same reason the team roster keeps its unmeasured
 * rows.
 *
 * Agents keep the order the board gave them, which is already "most blocked
 * first". Team leaders and managers are sorted by what they owe, so the
 * roster opens on the work rather than on the alphabet.
 */
export function groupIntoRoster(rows: DevelopmentRow[]): RosterManager[] {
  const byLead = new Map<string, DevelopmentRow[]>();
  for (const row of rows) {
    const key = row.supervisorName ?? NO_TEAM_LEAD;
    byLead.set(key, [...(byLead.get(key) ?? []), row]);
  }

  const leads: Array<RosterTeamLead & { manager: string }> = [...byLead.entries()].map(([name, agents]) => {
    const sum = (pick: (row: DevelopmentRow) => number) => agents.reduce((n, r) => n + pick(r), 0);
    return {
      // A team can straddle sites and managers in the raw data; the one most
      // of its people carry is the one the row names, the same rule the team
      // roster uses rather than picking whoever happens to sort first.
      manager: commonest(agents.map((a) => a.managerName ?? NO_MANAGER)) ?? NO_MANAGER,
      name,
      site: commonest(agents.map((a) => a.site).filter((s): s is string => s !== null)),
      headcount: agents.length,
      openItems: sum((r) => r.openItems),
      missingRca: sum((r) => r.missingRca),
      missingPlan: sum((r) => r.missingPlan),
      awaitingAcknowledgement: sum((r) => r.awaitingAcknowledgement),
      needsTraining: sum((r) => r.needsTraining),
      needsCoaching: sum((r) => r.needsCoaching),
      nearingClose: agents.filter((r) => r.bestProgress >= SUSTAINED_WEEKS - 1).length,
      topKpi: topKpiOf(agents),
      agents,
    };
  });

  const byManager = new Map<string, RosterTeamLead[]>();
  for (const { manager, ...lead } of leads) {
    byManager.set(manager, [...(byManager.get(manager) ?? []), lead]);
  }

  return [...byManager.entries()]
    .map(([name, teamLeads]) => ({
      name,
      teamLeadCount: teamLeads.length,
      headcount: teamLeads.reduce((n, l) => n + l.headcount, 0),
      teamLeads: [...teamLeads].sort(byMostOwed),
    }))
    .sort(
      (a, b) =>
        b.teamLeads.reduce((n, l) => n + l.missingRca, 0) - a.teamLeads.reduce((n, l) => n + l.missingRca, 0) ||
        b.headcount - a.headcount ||
        a.name.localeCompare(b.name),
    );
}

/** The value most of a list carries; null for an empty list. Ties break alphabetically. */
function commonest(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.length ? ranked[0][0] : null;
}

export interface DevelopmentBoard {
  reader: BoardReader;
  rows: DevelopmentRow[];
  totals: {
    peopleInDevelopment: number;
    openItems: number;
    missingRca: number;
    missingPlan: number;
    awaitingAcknowledgement: number;
    needsTraining: number;
    needsCoaching: number;
    monitoring: number;
    nearingClose: number;
  };
}

/** Whether an item's plan has asked for a trainer's or an SME's help. */
export function supportRequested(
  item: Pick<ActionItemListRow, "coachingRequired" | "trainingRequired">,
): boolean {
  return item.coachingRequired || item.trainingRequired;
}

/** Past acknowledgement: every passing week counts from here. */
const COUNTING_STATUSES: ReadonlySet<string> = new Set(["ACKNOWLEDGED", "MONITORING", "SUSTAINED"]);

/**
 * Decides what a person needs next, and how urgently.
 *
 * Ordered by who is blocked on the supervisor rather than by who is worst
 * performing: an item with no root cause cannot progress at all until someone
 * writes one, while an item three weeks into monitoring is already working.
 * A development board that sorted by severity would bury the items that are
 * actually stuck.
 *
 * The wording depends on who is reading. A leader's board names what they
 * owe ("Record root cause"); an agent reading their own plan was shown the
 * same words, in red, as though the root cause were theirs to write. Their
 * column says whose move it is instead — and the one step that is theirs,
 * acknowledging the plan, is put to them directly. A support role gets its
 * own reading, below.
 */
export function assess(
  items: ActionItemListRow[],
  reader: BoardReader = "leader",
): Pick<DevelopmentRow, "nextStep" | "urgency"> {
  if (reader === "support") return assessForSupport(items);
  const forAgent = reader === "agent";

  if (items.some((i) => !i.hasRca)) {
    return {
      nextStep: forAgent ? "Your supervisor is recording the root cause" : "Record root cause",
      urgency: 0,
    };
  }
  if (items.some((i) => !i.hasActionPlan)) {
    return {
      nextStep: forAgent ? "Your supervisor is writing the action plan" : "Write action plan",
      urgency: 1,
    };
  }
  if (items.some((i) => i.status === "AWAITING_AGENT_ACKNOWLEDGEMENT")) {
    return {
      nextStep: forAgent ? "Acknowledge your plan" : "Awaiting agent acknowledgement",
      urgency: 2,
    };
  }
  if (items.some((i) => i.status === "REOPENED")) {
    // A reopened item does not count passing weeks again until the plan has
    // been sent again and acknowledged — the button alone did not say so.
    return {
      nextStep: forAgent
        ? "Reopened — your supervisor will update the plan"
        : "Reopened — update the plan and send it to the agent again",
      urgency: 3,
    };
  }

  const best = Math.max(...items.map((i) => i.consecutivePassingWeeks));
  if (best >= SUSTAINED_WEEKS - 1) {
    return { nextStep: `Close to sustained (${best}/${SUSTAINED_WEEKS})`, urgency: 5 };
  }
  return { nextStep: `Monitoring (${best}/${SUSTAINED_WEEKS})`, urgency: 4 };
}

/**
 * A support role's next step is what was asked of them and where the item
 * stands. The root cause and the plan are the team leader's to write, so a
 * row is never "blocked" on a trainer; the leader's urgency scale is kept
 * only so reopened work reads the same everywhere.
 */
function assessForSupport(items: ActionItemListRow[]): Pick<DevelopmentRow, "nextStep" | "urgency"> {
  const asked = [
    items.some((i) => i.trainingRequired) && "training",
    items.some((i) => i.coachingRequired) && "coaching",
  ].filter((s): s is string => Boolean(s));
  const phrase = asked.length > 0 ? `${asked.join(" and ")} requested` : "no support requested";
  const support = phrase.charAt(0).toUpperCase() + phrase.slice(1);

  if (items.some((i) => !i.hasRca)) {
    return { nextStep: `${support} · root cause not recorded yet`, urgency: 0 };
  }
  if (items.some((i) => !i.hasActionPlan)) {
    return { nextStep: `${support} · plan not written yet`, urgency: 1 };
  }
  if (items.some((i) => i.status === "AWAITING_AGENT_ACKNOWLEDGEMENT")) {
    return { nextStep: `${support} · awaiting the agent's acknowledgement`, urgency: 2 };
  }
  if (items.some((i) => i.status === "REOPENED")) {
    return { nextStep: `${support} · reopened, plan being updated`, urgency: 3 };
  }
  const best = Math.max(...items.map((i) => i.consecutivePassingWeeks));
  if (best >= SUSTAINED_WEEKS - 1) {
    return { nextStep: `${support} · close to sustained (${best}/${SUSTAINED_WEEKS})`, urgency: 5 };
  }
  return { nextStep: `${support} · monitoring (${best}/${SUSTAINED_WEEKS})`, urgency: 4 };
}

/** A leader's board: the most blocked first, then the busiest, then by name. */
function byMostBlocked(a: DevelopmentRow, b: DevelopmentRow): number {
  return a.urgency - b.urgency || b.openItems - a.openItems || a.employeeName.localeCompare(b.employeeName);
}

/**
 * A support role's queue: the same KPI together, then the same team leader
 * together, because a trainer coaches in batches and repeats of one KPI
 * usually share a root cause. A person with items on two KPIs sits under
 * the first alphabetically; their other item is on the same row.
 */
function byKpiThenLeader(a: DevelopmentRow, b: DevelopmentRow): number {
  return (
    (a.kpis[0] ?? "").localeCompare(b.kpis[0] ?? "") ||
    (a.supervisorName ?? "").localeCompare(b.supervisorName ?? "") ||
    a.employeeName.localeCompare(b.employeeName)
  );
}

/**
 * Groups open items per person and totals them, pure so it can be pinned
 * without a database. A supervisor develops people, not tickets, and
 * someone with three open items needs one conversation rather than three.
 */
export function buildDevelopmentBoard(items: ActionItemListRow[], reader: BoardReader): DevelopmentBoard {
  const byEmployee = new Map<string, ActionItemListRow[]>();
  for (const item of items) {
    if (!OPEN_STATUSES.includes(item.status as never)) continue;
    byEmployee.set(item.employeeId, [...(byEmployee.get(item.employeeId) ?? []), item]);
  }

  const rows: DevelopmentRow[] = [...byEmployee.entries()]
    .map(([employeeId, list]) => {
      const { nextStep, urgency } = assess(list, reader);
      return {
        employeeId,
        employeeName: list[0].employeeName,
        supervisorName: list[0].supervisorName,
        managerName: list[0].managerName,
        site: list[0].site,
        items: list,
        openItems: list.length,
        missingRca: list.filter((i) => !i.hasRca).length,
        missingPlan: list.filter((i) => i.hasRca && !i.hasActionPlan).length,
        awaitingAcknowledgement: list.filter(
          (i) => i.status === "AWAITING_AGENT_ACKNOWLEDGEMENT",
        ).length,
        needsTraining: list.filter((i) => i.trainingRequired).length,
        needsCoaching: list.filter((i) => i.coachingRequired).length,
        monitoring: list.filter((i) => COUNTING_STATUSES.has(i.status)).length,
        bestProgress: Math.max(...list.map((i) => i.consecutivePassingWeeks)),
        kpis: [...new Set(list.map((i) => i.kpiName))].sort(),
        nextStep,
        urgency,
      };
    })
    .sort(reader === "support" ? byKpiThenLeader : byMostBlocked);

  const sum = (pick: (row: DevelopmentRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  return {
    reader,
    rows,
    totals: {
      peopleInDevelopment: rows.length,
      openItems: sum((r) => r.openItems),
      missingRca: sum((r) => r.missingRca),
      missingPlan: sum((r) => r.missingPlan),
      awaitingAcknowledgement: sum((r) => r.awaitingAcknowledgement),
      needsTraining: sum((r) => r.needsTraining),
      needsCoaching: sum((r) => r.needsCoaching),
      monitoring: sum((r) => r.monitoring),
      nearingClose: rows.filter((r) => r.bestProgress >= SUSTAINED_WEEKS - 1).length,
    },
  };
}

/**
 * Everyone in the caller's scope with open development work, and where each
 * of them is in the cycle.
 *
 * Built from the same action-item query the list view uses. A trainer or
 * SME reads the whole floor, which is hundreds of rows ordered by what the
 * team leaders owe — nothing they can act on. Their board opens on the
 * items whose plan asked for training or coaching, with every open item
 * one click away (`everyItem`).
 */
export async function getDevelopmentBoard(
  user: CurrentUser,
  options: { everyItem?: boolean } = {},
): Promise<DevelopmentBoard> {
  // Every open item, uncapped: the totals are counts of the whole board,
  // and the page itself decides how many rows to render.
  const items = await getActionItems(user, { openOnly: true, limit: null });
  const reader = boardReaderFor(user);
  const queue = reader === "support" && !options.everyItem ? items.filter(supportRequested) : items;
  return buildDevelopmentBoard(queue, reader);
}
