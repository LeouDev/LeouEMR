import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { NavigationProgressBar, NavigationProgressProvider } from "@/components/navigation-progress";
import { PageTransition } from "@/components/page-transition";
import { SIDEBAR_COOKIE } from "@/components/sidebar-shell";
import Link from "next/link";
import { getCurrentUser, sessionAssurance } from "@/lib/auth/session";
import { graceUntilSetting, mfaDecision, todayUtc } from "@/lib/auth/mfa";

/**
 * The persistent shell for every authenticated page: the sidebar beside
 * the page's own column.
 *
 * AppSidebar mounts once here, not per page — Next.js keeps a shared
 * layout mounted across client-side navigations between the routes
 * beneath it, so keeping the chrome out of individual pages is what stops
 * it from being torn down and recreated on every navigation. Only
 * PageTransition's children change per route.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  // The second step, decided from the users table so it holds even for a
  // session whose token predates the role being recorded in it.
  const graceUntil = graceUntilSetting();
  const { aal } = await sessionAssurance();
  // An unreadable level (null) is not enforced here either, matching the
  // middleware — otherwise the two would bounce a verified session between
  // /mfa and the page until the level could be read again.
  const mfa = aal === null ? "ok" : mfaDecision({ role: user.role, aal, today: todayUtc(), graceUntil });
  if (mfa === "enrol") redirect("/mfa");

  // A folded rail is remembered in a cookie so it renders folded from the
  // server, rather than expanded and then snapping shut once hydrated.
  const sidebarOpen = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "collapsed";

  return (
    <NavigationProgressProvider>
      <div className="flex min-h-screen flex-col bg-cream md:flex-row">
        <AppSidebar user={user} initialOpen={sidebarOpen} />
        <div className="flex min-w-0 flex-1 flex-col">
          {mfa === "grace" && graceUntil && (
            <div className="border-b-2 border-warn bg-warn-bg px-6 py-2.5 text-center text-sm font-semibold text-warn print:hidden">
              Your role will need an authenticator app to sign in from {formatDate(graceUntil)}.{" "}
              <Link href="/mfa" className="underline underline-offset-4">
                Set it up now
              </Link>
              .
            </div>
          )}
          {/* Pinned to the top of the page column, so it is visible at any
              scroll depth the moment a link or filter is used — before the
              server has sent anything back. */}
          <div className="sticky top-0 z-30 print:hidden">
            <NavigationProgressBar />
          </div>
          <PageTransition>{children}</PageTransition>
        </div>
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
