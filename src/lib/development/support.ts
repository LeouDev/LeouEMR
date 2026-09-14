import { isSupportRole } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Whether the caller may rewrite an RCA or an action plan that already
 * exists.
 *
 * A trainer or SME works an item alongside its team leader, and both could
 * edit the same root cause with the last save winning. This keeps one owner
 * per record: a support role may write a record where none exists and edit
 * what they wrote themselves, but a record someone else wrote is read-only
 * to them — they add a dated note under the root cause, a time-and-motion
 * study, or (on the plan) change whether training or coaching is required.
 * Leaders and administrators are unchanged.
 */
export function canRewriteRecord(user: CurrentUser, createdBy: string | null | undefined): boolean {
  if (!isSupportRole(user)) return true;
  return !createdBy || createdBy === user.id;
}

export const SUPPORT_RCA_LOCKED =
  "Recorded by someone else — add a dated note under it rather than editing it";
export const SUPPORT_PLAN_LOCKED =
  "Written by someone else — only whether training or coaching is required can be changed here";
