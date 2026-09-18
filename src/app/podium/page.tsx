import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { podiumEnabled } from "@/lib/podium/gate";
import { getTopPerformers } from "@/lib/queries/top-performers";
import { monthStartOf, todayInManila } from "@/lib/scorecard/review";
import { PodiumIntro } from "./podium-intro";

/**
 * The top-performers podium, shown once per browser session on the way in.
 *
 * Deliberately outside the `(shell)` route group — like `/login`, `/mfa`
 * and `/survey` — so no sidebar or nav renders around it. This one is a
 * celebration rather than a gate, though, and the difference shows in what
 * happens when it has nothing to say: it steps aside. The visit is already
 * recorded by the time this runs (the middleware sets the cookie on the
 * request that fetches this page), so every exit below happens exactly
 * once and cannot bounce anyone back here.
 *
 * Which month: the one Manila is in. The server's UTC clock would keep the
 * new month's podium hidden until eight in the morning on the first.
 */
export default async function PodiumPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (!podiumEnabled()) redirect("/dashboard");

  const data = await topPerformersOrNothing();
  // Nothing scored yet this month — the first days of one, before a week
  // has been imported. An empty podium is worse than no podium.
  if (data === null || (data.agents.length === 0 && data.supervisors.length === 0)) {
    redirect("/dashboard");
  }

  return <PodiumIntro data={data} />;
}

/**
 * The month's podium, or null if it could not be read.
 *
 * A whole month of scorecards is the heaviest thing this app computes, and
 * it sits between four hundred people and the first page of their day.
 * Failing here must cost them the celebration and nothing else, so the
 * error is logged and the page steps aside rather than showing anyone an
 * error screen on the way in.
 */
async function topPerformersOrNothing() {
  try {
    return await getTopPerformers(monthStartOf(todayInManila()));
  } catch (error) {
    console.error("[podium] could not read the month's top performers; going straight to the dashboard", error);
    return null;
  }
}
