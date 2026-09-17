import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { surveyResponses, users } from "@/lib/db/schema";
import type { SurveyResponseRow } from "@/lib/survey/summary";

/**
 * Every survey response, newest first, for the admin dashboard.
 *
 * Read whole rather than paginated, and filtered in the browser: there is
 * one response per account and the roster is in the hundreds, so the entire
 * set is smaller than a single week of the performance tables. The handoff
 * asks for server-side search and paging "once response volume grows" —
 * it cannot grow past the number of accounts, which is the point of a
 * one-per-account survey, so that day does not come.
 *
 * Joined to `users` for the name, because a response is only ever read as
 * "who said this" — the raw row carries an id.
 */
export async function getSurveyResponses(): Promise<SurveyResponseRow[]> {
  const rows = await db
    .select({
      id: surveyResponses.id,
      respondentName: users.name,
      respondentEmail: users.email,
      submittedAt: surveyResponses.submittedAt,
      q1Overall: surveyResponses.q1Overall,
      q2Ease: surveyResponses.q2Ease,
      q3Findability: surveyResponses.q3Findability,
      q4Nps: surveyResponses.q4Nps,
      q5Feedback: surveyResponses.q5Feedback,
    })
    .from(surveyResponses)
    .innerJoin(users, eq(users.id, surveyResponses.userId))
    .orderBy(desc(surveyResponses.submittedAt));

  // The timestamp crosses into a client component, where a Date does not
  // survive serialization intact — an ISO string does, and the filter and
  // the sort both compare it as text.
  return rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }));
}

/**
 * How many active accounts have answered, for the dashboard's coverage line.
 *
 * Both figures come off one pass over the active accounts, so they cannot
 * disagree. Counted separately they did: every response ever filed against
 * the accounts that exist *now* meant a disabled leaver who had answered
 * still counted in the numerator but not the denominator, and the line read
 * "410 of 390 active accounts have answered."
 */
export async function getSurveyCoverage(): Promise<{ responded: number; accounts: number }> {
  const [row] = await db
    .select({
      responded: sql<number>`count(${surveyResponses.id})::int`,
      accounts: sql<number>`count(*)::int`,
    })
    .from(users)
    .leftJoin(surveyResponses, eq(surveyResponses.userId, users.id))
    .where(eq(users.status, "active"));

  return { responded: row?.responded ?? 0, accounts: row?.accounts ?? 0 };
}
