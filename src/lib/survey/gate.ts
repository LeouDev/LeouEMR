import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { surveyResponses } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * The post-login survey gate: whether this account still owes its answers.
 *
 * Five questions, once per account, blocking the rest of the app until they
 * are in. Every active role is gated — it is the website being rated, and
 * everyone uses the website.
 */

/**
 * When the gate opens, from the environment rather than a literal in the
 * code, so the date can move without a code change.
 *
 * `SURVEY_LIVE_FROM` takes an ISO timestamp — include the offset, or it is
 * read as UTC and the gate opens eight hours late in Manila. The literal
 * `off` disables the gate outright: this blocks every account's access to a
 * production system, and the switch that turns it off has to be reachable
 * faster than a deploy. Anything unparseable is treated as `off` for the
 * same reason — a typo in a date must not lock four hundred people out.
 *
 * The default is the launch the business asked for: 18 September 2026,
 * 6:00 PM Manila.
 */
export const DEFAULT_LIVE_FROM = "2026-09-18T18:00:00+08:00";

export function surveyLiveFrom(): Date | null {
  const raw = process.env.SURVEY_LIVE_FROM?.trim();
  if (raw === "off") return null;
  const value = raw ? new Date(raw) : new Date(DEFAULT_LIVE_FROM);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** True once the launch moment has passed; false while the feature is off or still ahead. */
export function surveyIsLive(now: Date = new Date()): boolean {
  const from = surveyLiveFrom();
  return from !== null && now >= from;
}

/**
 * Whether to send this person to the survey instead of the page they asked
 * for.
 *
 * **Fails open, on purpose.** Every branch that cannot answer the question
 * returns false, and the database read is wrapped: a survey table that is
 * missing, unreachable or slow must not keep anyone out of the app they do
 * their job in. A missed survey response costs nothing; four hundred people
 * locked out of a production EMR costs a shift. The error is logged so the
 * failure is visible rather than silent.
 *
 * Only an active account is gated — someone still pending approval has no
 * dashboard to be kept from, and the MFA step comes first either way.
 */
export async function surveyDueFor(user: CurrentUser, now: Date = new Date()): Promise<boolean> {
  if (user.status !== "active") return false;
  if (!surveyIsLive(now)) return false;

  try {
    const [done] = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(eq(surveyResponses.userId, user.id))
      .limit(1);
    return done === undefined;
  } catch (error) {
    console.error("[survey] could not read the completion flag; letting the request through", error);
    return false;
  }
}
