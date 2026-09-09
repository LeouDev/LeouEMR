import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { NavigationProgressBar, NavigationProgressProvider } from "@/components/navigation-progress";
import { PageTransition } from "@/components/page-transition";
import { getCurrentUser } from "@/lib/auth/session";

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

  return (
    <NavigationProgressProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader user={user} />
        {/* Directly under the sticky header, so it is visible at any scroll
            depth the moment a tab or filter is used — before the server has
            sent anything back. */}
        <NavigationProgressBar />
        <PageTransition>{children}</PageTransition>
      </div>
    </NavigationProgressProvider>
  );
}
