"use client";

import { usePathname } from "next/navigation";

/**
 * Fades the active page in on navigation without ever touching the sidebar.
 *
 * This wraps only the shell layout's `children` — a sibling of AppSidebar,
 * never a parent — so remounting here on route change cannot affect the
 * sidebar's lifecycle. Keyed on pathname so the fade also replays navigating
 * between two renders of the same route (one employee id to another), where
 * React would otherwise reuse the existing DOM node and skip it.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-transition">
      {children}
    </div>
  );
}
