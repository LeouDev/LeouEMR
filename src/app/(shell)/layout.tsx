import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { NavigationProgressBar, NavigationProgressProvider } from "@/components/navigation-progress";
import { PageTransition } from "@/components/page-transition";
import Link from "next/link";
import { getCurrentUser, sessionAssurance } from "@/lib/auth/session";
import { graceUntilSetting, mfaDecision, todayUtc } from "@/lib/auth/mfa";

/**
 * The persistent shell for every authenticated page.
 *
 * AppHeader (and the animated scene inside it) mounts once here, not per
 * page — Next.js keeps a shared layout mounted across client-side
 * navigations between the routes beneath it, so moving the header out of
 * individual pages and into this layout is what stops it from being torn
 * down and recreated on every tab switch. Only PageTransition's children
 * change per route.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  // The second step, decided from the users table so it holds even for a
  // session whose token predates the role being recorded in it.
  const graceUntil = graceUntilSetting();
  const { aal } = await sessionAssurance();
  const mfa = mfaDecision({ role: user.role, aal, today: todayUtc(), graceUntil });
  if (mfa === "enrol") redirect("/mfa");

  return (
    <NavigationProgressProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader user={user} />
        {mfa === "grace" && graceUntil && (
          <div className="border-b-2 border-warn bg-warn-bg px-6 py-2.5 text-center text-sm font-semibold text-warn">
            Your role will need an authenticator app to sign in from {formatDate(graceUntil)}.{" "}
            <Link href="/mfa" className="underline underline-offset-4">
              Set it up now
            </Link>
            .
          </div>
        )}
        {/* Directly under the sticky header, so it is visible at any scroll
            depth the moment a tab or filter is used — before the server has
            sent anything back. */}
        <NavigationProgressBar />
        <PageTransition>{children}</PageTransition>
      </div>
    </NavigationProgressProvider>
  );
}

function formatDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
