import type { MasterlistMonth } from "@/lib/org/assignments";
import { periodContaining } from "@/lib/queries/period";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A committed import batch as the weekly import reads it back. */
export interface MasterlistBatchRow {
  id: string;
  validationSummary: unknown;
}

/**
 * The month a committed masterlist batch is the roster for, from the
 * summary the upload recorded. Newer uploads store the month's first day
 * outright; the first ones only stored the label ("September 2026"), which
 * is parsed here so they are honoured too. Anything that is not a
 * masterlist batch, or whose month cannot be read, is skipped.
 */
export function masterlistMonthFromBatch(batch: MasterlistBatchRow): MasterlistMonth | null {
  const summary = batch.validationSummary;
  if (typeof summary !== "object" || summary === null) return null;
  const { kind, monthStart, month } = summary as { kind?: unknown; monthStart?: unknown; month?: unknown };
  if (kind !== "masterlist") return null;

  const anchor =
    typeof monthStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(monthStart)
      ? monthStart
      : typeof month === "string"
        ? firstDayFromLabel(month)
        : null;
  if (!anchor) return null;

  const period = periodContaining("month", anchor);
  return { batchId: batch.id, start: period.start, end: period.end };
}

/** "September 2026" → "2026-09-01"; null for anything else. */
function firstDayFromLabel(label: string): string | null {
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const monthIndex = MONTHS.indexOf(match[1].toLowerCase());
  if (monthIndex === -1) return null;
  return `${match[2]}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}
