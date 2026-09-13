/**
 * Which action item a figure on the employee page belongs to. The
 * development-plan grid and the skill breakdown show one figure per KPI
 * per week; where an action item was tracking that KPI that week, the
 * figure links to it, so the grid itself is the index of the plans — the
 * separate "development item" table it replaced said nothing the red cells
 * did not.
 */

export interface TrackedIssue {
  actionItemId: string;
  actionItemCode: string;
  kpiCode: string;
  status: string;
  openedWeek: string;
  history: ReadonlyMap<string, { result: "pass" | "fail"; consecutiveCountAfter: number }>;
  noteWeeks: ReadonlySet<string>;
}

export interface CellLink {
  actionItemId: string;
  actionItemCode: string;
  failed: boolean;
  /** The week the item opened on. */
  opened: boolean;
  /** A pass that advanced the four-week counter (one before acknowledgement does not). */
  counted: boolean;
  consecutiveCountAfter: number;
  /** The root cause carries a note for this week. */
  noted: boolean;
}

export const cellKey = (kpiCode: string, week: string) => `${kpiCode}|${week}`;

/**
 * One link per KPI-week that an item evaluated. When two episodes of the
 * same KPI both cover a week (a closed one and the one that reopened), the
 * live one wins, so the link leads to the plan still being worked.
 */
export function actionItemLinks(issues: readonly TrackedIssue[]): Map<string, CellLink> {
  const links = new Map<string, CellLink>();
  const ordered = [...issues].sort((a, b) => Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED"));
  for (const issue of ordered) {
    for (const [week, point] of issue.history) {
      const key = cellKey(issue.kpiCode, week);
      if (links.has(key)) continue;
      const failed = point.result === "fail";
      links.set(key, {
        actionItemId: issue.actionItemId,
        actionItemCode: issue.actionItemCode,
        failed,
        opened: issue.openedWeek === week,
        counted: !failed && point.consecutiveCountAfter > 0,
        consecutiveCountAfter: point.consecutiveCountAfter,
        noted: issue.noteWeeks.has(week),
      });
    }
  }
  return links;
}

/** The hover text: what that week meant for the item, and that clicking opens it. */
export function linkTitle(link: CellLink): string {
  const what = link.noted
    ? "This week has a note against the root cause"
    : link.opened
      ? "Failed — the week this item opened"
      : link.failed
        ? "Failed — the four-week counter reset to zero"
        : link.counted
          ? `Passed — ${link.consecutiveCountAfter} of 4 sustained weeks`
          : "Passed before the item was acknowledged, so it does not count";
  return `${link.actionItemCode} · ${what}. Open the action item.`;
}
