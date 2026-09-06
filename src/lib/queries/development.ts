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
 */
function assess(items: ActionItemListRow[]): Pick<DevelopmentRow, "nextStep" | "urgency"> {
  if (items.some((i) => !i.hasRca)) return { nextStep: "Record root cause", urgency: 0 };
  if (items.some((i) => !i.hasActionPlan)) return { nextStep: "Write action plan", urgency: 1 };
  if (items.some((i) => i.status === "AWAITING_AGENT_ACKNOWLEDGEMENT")) {
    return { nextStep: "Awaiting agent acknowledgement", urgency: 2 };
  }
  if (items.some((i) => i.status === "REOPENED")) return { nextStep: "Reopened — revisit plan", urgency: 3 };

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
  const items = await getActionItems(user, { openOnly: true, limit: 1000 });

  const byEmployee = new Map<string, ActionItemListRow[]>();
  for (const item of items) {
    if (!OPEN_STATUSES.includes(item.status as never)) continue;
    byEmployee.set(item.employeeId, [...(byEmployee.get(item.employeeId) ?? []), item]);
  }

  const rows: DevelopmentRow[] = [...byEmployee.entries()]
    .map(([employeeId, list]) => {
      const { nextStep, urgency } = assess(list);
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
