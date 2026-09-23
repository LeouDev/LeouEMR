import { redirect } from "next/navigation";
import { PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getSurveyCoverage, getSurveyResponses } from "@/lib/queries/survey";
import { surveyIsLive, surveyLiveFrom } from "@/lib/survey/gate";
import { ResponsesTable } from "./responses-table";
import { SurveyTabs } from "./survey-tabs";

/**
 * Every post-login survey response, for an administrator.
 *
 * Admin only, and not because the figures are sensitive on their own: a
 * response carries the respondent's name beside what they said about the
 * tool their own performance is measured in. That is feedback given under a
 * name, and it is not a leader's to browse about their own reports.
 */
export default async function SurveyResultsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin") redirect("/dashboard");

  // Sequential, not a Promise.all: both are small reads, and the pattern in
  // this app is to keep concurrent database work off the pooler unless it
  // buys something (see manager-overview.tsx).
  const rows = await getSurveyResponses();
  const coverage = await getSurveyCoverage();

  const liveFrom = surveyLiveFrom();
  const status = !liveFrom
    ? "The gate is switched off (SURVEY_LIVE_FROM=off), so nobody is being asked."
    : surveyIsLive()
      ? `${coverage.responded} of ${coverage.accounts} active accounts have answered.`
      : `The gate opens ${liveFrom.toLocaleString("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Asia/Manila",
        })} Manila time. Nobody is being asked yet.`;

  return (
    <>
      <PageBand title="Survey Results" subtitle="Post-login survey responses and how the tool is used" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <SurveyTabs active="responses" />
        <p className="mb-7 text-sm text-muted">
          Collected from people after signing in, before they could continue to the site. {status}
        </p>
        <ResponsesTable rows={rows} />
      </main>
    </>
  );
}
