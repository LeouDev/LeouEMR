import { LAST_LEGACY_WEEK_START, weekContaining } from "@/lib/queries/period";

export interface RowWeek {
  weekStart: string;
  weekEnd: string;
  /**
   * True when the row lies in the re-cut range but carried no readable date,
   * so its week label had to place it. The import reports these so a file
   * whose date column went missing is noticed rather than silently binned
   * by label.
   */
  byLabel: boolean;
}

/**
 * The reporting week a source row belongs to.
 *
 * From the last legacy week on (Sat 23 May 2026, see period.ts) a row is
 * placed by its own date, because the operation's Sunday-to-Saturday week
 * and the workbook's "WE <Friday>" label describe different seven days:
 * the label's Saturday belongs to the following reporting week. Before
 * that the label places the row, exactly as the weeks already reported
 * were built. A re-cut-range row with no readable date falls back to the
 * reporting week containing the label's Friday.
 */
export function weekForRow(
  label: { weekStart: string; weekEnd: string } | null,
  date: string | null,
): RowWeek | null {
  if (date && date >= LAST_LEGACY_WEEK_START) {
    const week = weekContaining(date);
    return { weekStart: week.start, weekEnd: week.end, byLabel: false };
  }
  if (!label) return null;
  if (label.weekEnd >= LAST_LEGACY_WEEK_START) {
    const week = weekContaining(label.weekEnd);
    return { weekStart: week.start, weekEnd: week.end, byLabel: true };
  }
  return { weekStart: label.weekStart, weekEnd: label.weekEnd, byLabel: false };
}
