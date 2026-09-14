import { isSupportRole } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { OPEN_STATUSES, getActionItems } from "./performance";
import type { ActionItemListRow } from "./performance";

/** Weeks of sustained passing required to close an issue (spec section 26). */
export const SUSTAINED_WEEKS = 4;

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
