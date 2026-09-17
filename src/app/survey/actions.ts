"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { surveyResponses } from "@/lib/db/schema";
import { surveyIsLive } from "@/lib/survey/gate";

export type SubmitSurveyResult = { ok: true } | { ok: false; error: string };

const scale = z.number().int().min(1).max(5);

const submitSchema = z.object({
  q1Overall: scale,
  q2Ease: scale,
  q3Findability: scale,
  q4Nps: z.number().int().min(0).max(10),
  q5Feedback: z.string().trim().min(1, "Tell us one thing we could improve").max(4000),
});

/**
 * Files one account's survey answers.
 *
 * The bounds are re-checked here and not only in the wizard: the buttons
 * cannot produce a 7 out of 5, but a server action is a public endpoint and
 * the stored figures feed the admin dashboard's averages.
 *
 * Writing the row is what clears the gate, so this is deliberately the only
 * way to clear it — there is no "skip" path to be found by anyone reading
 * the network tab.
 */
export async function submitSurvey(input: unknown): Promise<SubmitSurveyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to submit this." };
  if (user.status !== "active") return { ok: false, error: "This account is not active yet." };
  // Filing before the gate opens would mark someone done for a survey they
  // were never shown, and quietly exempt them once it does open.
  if (!surveyIsLive()) return { ok: false, error: "The survey is not open." };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your answers and try again." };
  }

  // One row per account, enforced by the unique index rather than by a read
  // first: two tabs submitting at once would both pass a check-then-write.
  // A second submission is not an error — the person is already through, and
  // the first set of answers stands.
  await db
    .insert(surveyResponses)
    .values({ userId: user.id, ...parsed.data })
    .onConflictDoNothing({ target: surveyResponses.userId });

  return { ok: true };
}
