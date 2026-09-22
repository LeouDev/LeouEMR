import { STATUS_LABELS } from "@/components/ui";
import type { ActionItemListRow } from "@/lib/queries/performance";

/**
 * The action-item list as rows a spreadsheet can hold: the columns the page
 * shows, plus the team, manager and site the list is grouped by elsewhere,
 * and the plan's coaching/training flags — everything a leader would
 * otherwise copy out by hand for a weekly review. Pure, so the file's
 * contents are tested without a route or a database.
 */

export const ACTION_ITEMS_EXPORT_HEADER: readonly string[] = [
  "Item",
  "Employee",
  "Team leader",
  "Manager",
  "Site",
  "KPI",
  "Status",
  "Passing weeks",
  "Opened week",
  "RCA",
  "Action plan",
  "Coaching required",
  "Training required",
];

const yes = (flag: boolean) => (flag ? "Yes" : "No");

export function actionItemsExportRows(items: readonly ActionItemListRow[]): Array<Array<string | number>> {
  return items.map((item) => [
    item.actionItemCode,
    item.employeeName,
    item.supervisorName ?? "",
    item.managerName ?? "",
    item.site ?? "",
    item.kpiName,
    STATUS_LABELS[item.status] ?? item.status,
    item.consecutivePassingWeeks,
    item.openedWeek,
    yes(item.hasRca),
    yes(item.hasActionPlan),
    yes(item.coachingRequired),
    yes(item.trainingRequired),
  ]);
}

/** `action-items-active-2026-09-22`, or `-all-` when resolved items are included. */
export function actionItemsExportFilename(today: string, openOnly: boolean): string {
  return `action-items-${openOnly ? "active" : "all"}-${today}`;
}
