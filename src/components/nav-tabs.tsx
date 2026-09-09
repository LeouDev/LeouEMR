"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The header's only pathname-reactive slice.
 *
 * Isolated into its own client component so navigating between tabs
 * re-renders just this strip of links — the header shell around it (the
 * identity block, the animated scene) has no dependency on the route and so
 * is never touched by one, let alone remounted.
 */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        // A section stays active on its own sub-routes (e.g. an employee
        // detail page under /employees), matching the fixed `current` values
        // those pages used to pass in by hand.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            // With up to a dozen tabs all visible in the strip at once, default
            // viewport-prefetch fires every one of them the moment the header
            // mounts — a burst of concurrent full page renders on every single
            // navigation, not just the one the user actually clicked. The
            // (shell) loading.tsx already makes a real click feel instant, so
            // there is nothing this buys beyond that cost.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3.5 py-2.5 text-xs font-semibold tracking-[0.06em] whitespace-nowrap uppercase transition ${
              active
                ? "border-orange-brand text-cream"
                : "border-transparent text-navy-100/70 hover:text-cream"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
