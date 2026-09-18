import type { CurrentUser } from "@/lib/auth/session";

/**
 * The post-login podium: whether this browser session has seen it yet.
 *
 * Deliberately a cookie and not a table. The business asked for it on
 * every login, which is a property of the sign-in rather than of the
 * account, and a row per person per login would be a write on the login
 * path for four hundred people to record something nobody will ever query.
 *
 * The value is the account's own id, so the podium shows again when a
 * different person signs in on the same browser — a shared workstation is
 * the ordinary case on this floor. No Max-Age, so it is a session cookie:
 * it lasts as long as the browser session does, which is the closest thing
 * to "every login" that a cookie can honestly promise. Signing out cannot
 * clear it (that happens in the browser, and this is httpOnly), so signing
 * straight back in as the same person inside one browser session will not
 * replay the intro.
 */
export const PODIUM_COOKIE = "podiumSeen";

/**
 * A kill switch reachable faster than a deploy, the same shape as the
 * survey's. `PODIUM_INTRO=off` stands the podium down and the shell stops
 * redirecting to it; anything else leaves it on.
 *
 * This stands in front of the whole app for everyone who signs in, so
 * there has to be a way to take it down that does not wait on a build.
 */
export function podiumEnabled(): boolean {
  return process.env.PODIUM_INTRO?.trim() !== "off";
}

/**
 * Whether to show this person the podium instead of the page they asked
 * for.
 *
 * Deliberately decided from the cookie alone — no database read. Whether
 * there is a podium worth showing is a question for the podium page, which
 * can answer it after the sign-in has already completed; asking it here
 * would put a whole month's scorecards on the critical path of every first
 * page load. The page marks this cookie through the middleware before it
 * renders, so a month with no scores, or a page that fails outright,
 * bounces once to the dashboard rather than for ever.
 */
export function podiumDueFor(user: CurrentUser, seen: string | undefined): boolean {
  if (user.status !== "active") return false;
  if (!podiumEnabled()) return false;
  return seen !== user.id;
}
