import { OPEN_STATUSES, getActionItems } from "./performance";
import type { ActionItemListRow } from "./performance";
import type { CurrentUser } from "@/lib/auth/session";

/** Weeks of sustained passing required to close an issue (spec section 26). */
export const SUSTAINED_WEEKS = 4;

export interface DevelopmentRow {
  employeeId: string;
  employeeName: string;
  items: ActionItemListRow[];
  openItems: number;
  /** Items with no root cause recorded yet — the first thing a supervisor owes. */
  missingRca: number;
  /** Items with an RCA but no action plan. */
  missingPlan: number;
  awaitingAcknowledgement: number;
  /** Best progress across their open items, in weeks toward sustained. */
  bestProgress: number;
  /** The KPIs currently in development for this person. */
  kpis: string[];
  /** What this person needs next, as one phrase. */
  nextStep: string;
  /** Lower sorts first: the more blocked on the supervisor, the higher up. */
  urgency: number;
}

export interface DevelopmentBoard {
  rows: DevelopmentRow[];
  totals: {
    peopleInDevelopment: number;
    openItems: number;
    missingRca: number;
    missingPlan: number;
    awaitingAcknowledgement: number;
    nearingClose: number;
  };
}

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
 * acknowledging the plan, is put to them directly.
 */
export function assess(
  items: ActionItemListRow[],
  forAgent = false,
): Pick<DevelopmentRow, "nextStep" | "urgency"> {
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
 * Everyone in the caller's scope with open development work, and where each
 * of them is in the cycle.
 *
 * Built from the same action-item query the list view uses, grouped per
 * person: a supervisor develops people, not tickets, and someone with three
 * open items needs one conversation rather than three.
 */
export async function getDevelopmentBoard(user: CurrentUser): Promise<DevelopmentBoard> {
  // Every open item, uncapped: the totals below are counts of the whole
  // board, and the page itself decides how many rows to render.
  const items = await getActionItems(user, { openOnly: true, limit: null });
  const forAgent = user.role === "agent";

  const byEmployee = new Map<string, ActionItemListRow[]>();
  for (const item of items) {
    if (!OPEN_STATUSES.includes(item.status as never)) continue;
    byEmployee.set(item.employeeId, [...(byEmployee.get(item.employeeId) ?? []), item]);
  }

  const rows: DevelopmentRow[] = [...byEmployee.entries()]
    .map(([employeeId, list]) => {
      const { nextStep, urgency } = assess(list, forAgent);
      return {
        employeeId,
        employeeName: list[0].employeeName,
        items: list,
        openItems: list.length,
        missingRca: list.filter((i) => !i.hasRca).length,
        missingPlan: list.filter((i) => i.hasRca && !i.hasActionPlan).length,
        awaitingAcknowledgement: list.filter(
          (i) => i.status === "AWAITING_AGENT_ACKNOWLEDGEMENT",
        ).length,
        bestProgress: Math.max(...list.map((i) => i.consecutivePassingWeeks)),
        kpis: [...new Set(list.map((i) => i.kpiName))].sort(),
        nextStep,
        urgency,
      };
    })
    .sort((a, b) => a.urgency - b.urgency || b.openItems - a.openItems || a.employeeName.localeCompare(b.employeeName));

  return {
    rows,
    totals: {
      peopleInDevelopment: rows.length,
      openItems: rows.reduce((n, r) => n + r.openItems, 0),
      missingRca: rows.reduce((n, r) => n + r.missingRca, 0),
      missingPlan: rows.reduce((n, r) => n + r.missingPlan, 0),
      awaitingAcknowledgement: rows.reduce((n, r) => n + r.awaitingAcknowledgement, 0),
      nearingClose: rows.filter((r) => r.bestProgress >= SUSTAINED_WEEKS - 1).length,
    },
  };
}
