/**
 * Rules for paid time off, kept pure so they can be tested without a database.
 *
 * Dates are inclusive ISO days ("2026-08-24"). String comparison is safe for
 * that format and avoids constructing Date objects, which would drag the
 * server's timezone into what is a plain calendar question.
 */

export type PtoStatus = "pending" | "approved" | "denied" | "cancelled";

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Statuses that still hold the days — a denied or cancelled request does not. */
export const BLOCKING_STATUSES: PtoStatus[] = ["pending", "approved"];

export type RequestProblem =
  | "invalid-dates"
  | "end-before-start"
  | "too-long"
  | "overlaps-existing";

/** Longest single request. Anything beyond this is a leave of absence, not PTO. */
export const MAX_DAYS = 30;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day count. Both ends count, so a single day is 1, not 0. */
export function countDays(range: DateRange): number {
  const start = Date.parse(`${range.startDate}T00:00:00Z`);
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** True when two inclusive ranges share at least one day. */
export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Validates a request against its own dates and the requester's existing ones.
 *
 * Requests in the past are allowed on purpose: sick leave is routinely filed
 * after the fact, and refusing it would push that record out of the system
 * entirely.
 */
export function validateRequest(
  range: DateRange,
  existing: Array<DateRange & { status: PtoStatus }>,
): RequestProblem | null {
  if (!ISO_DAY.test(range.startDate) || !ISO_DAY.test(range.endDate)) return "invalid-dates";
  if (Number.isNaN(countDays(range))) return "invalid-dates";
  if (range.endDate < range.startDate) return "end-before-start";
  if (countDays(range) > MAX_DAYS) return "too-long";

  const clashes = existing
    .filter((e) => BLOCKING_STATUSES.includes(e.status))
    .some((e) => overlaps(range, e));

  return clashes ? "overlaps-existing" : null;
}

export const PROBLEM_MESSAGES: Record<RequestProblem, string> = {
  "invalid-dates": "Enter both a start and an end date.",
  "end-before-start": "The end date cannot be before the start date.",
  "too-long": `A single request cannot exceed ${MAX_DAYS} days.`,
  "overlaps-existing": "You already have a request covering some of those days.",
};

/** Whether a request can still be decided. A decided one is final. */
export function canDecide(status: PtoStatus): boolean {
  return status === "pending";
}

/** Whether the requester can still withdraw it. */
export function canCancel(status: PtoStatus): boolean {
  return status === "pending" || status === "approved";
}

/** Every inclusive day in a range, for laying requests onto a calendar. */
export function daysIn(range: DateRange): string[] {
  const out: string[] = [];
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  for (let t = Date.parse(`${range.startDate}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
