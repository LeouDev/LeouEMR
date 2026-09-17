import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser } from "@/lib/auth/session";
import { surveyDueFor } from "@/lib/survey/gate";
import { SurveyWizard } from "./survey-wizard";

/**
 * The post-login survey, five questions, once per account.
 *
 * Deliberately outside the `(shell)` route group — like `/login` and
 * `/mfa` — so no sidebar, no nav and no link out renders around it. The
 * gate is the point: there is nowhere to click to.
 *
 * Reached by the shell layout redirecting anyone who still owes answers.
 * The same check runs again here, so the page cannot be used to re-take the
 * survey or to see it before it opens: someone already through, or arriving
 * early, goes to their dashboard.
 */
export default async function SurveyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const due = await surveyDueFor(user);
  if (!due) redirect("/dashboard");

  return (
    <SurveyWizard
      signOut={
        // The one way off this page, and not a way past it: the gate is
        // waiting at the next sign-in. Without it someone who opened the
        // wrong account would be stuck in the tab with no recourse.
        <SignOutButton tone="light" />
      }
    />
  );
}
