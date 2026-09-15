"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useNavigation } from "./navigation-progress";
import { useSidebarOpen } from "./sidebar-context";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The sidebar's only pathname-reactive slice.
 *
 * Its own client component so navigating re-renders just this column of
 * links — the rail around it (brand, profile, toggle) has no dependency on
 * the route and is never touched by one, let alone remounted.
 */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { start } = useNavigation();
  const open = useSidebarOpen();

  return (
    <>
      {items.map((item) => {
        // A section stays active on its own sub-routes (an employee detail
        // page under /employees), matching the fixed `current` values the
        // pages used to pass in by hand.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            // With every destination visible at once, viewport prefetch would
            // fire all of them the moment the rail mounts — a burst of full
            // page renders on every navigation, not just the one clicked.
            prefetch={false}
            // Lights the progress bar the instant the link is clicked.
            onNavigate={start}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={`block overflow-hidden py-[9px] text-xs tracking-[0.03em] text-ellipsis whitespace-nowrap transition ${
              open ? "px-3.5" : "px-3.5 md:px-2"
            } ${active ? "bg-orange-brand font-bold text-navy-800" : "font-semibold text-cream/60 hover:bg-navy-700 hover:text-cream"}`}
          >
            <NavLabel label={item.label} />
          </Link>
        );
      })}
    </>
  );
}

/**
 * The link's own pending state: brightens and pulses the clicked label
 * while its page is still on its way, so the click visibly "took" before
 * the server has answered.
 */
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "animate-pulse text-cream motion-reduce:animate-none" : undefined}>{label}</span>;
}
