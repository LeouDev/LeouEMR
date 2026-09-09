"use client";

import Link, { type LinkProps } from "next/link";
import { useNavigation } from "./navigation-progress";

/**
 * A <Link> that lights the navigation progress bar the moment it is
 * clicked. For the in-page tab strips (MBO's pass/fail tabs, the PTO
 * team/cluster switch) that are links rather than router.push calls, so
 * they get the same instant feedback the main nav and the period picker
 * give.
 */
export function NavLink({
  children,
  className,
  ...props
}: LinkProps & { children: React.ReactNode; className?: string; prefetch?: boolean }) {
  const { start } = useNavigation();
  return (
    <Link {...props} className={className} onNavigate={start}>
      {children}
    </Link>
  );
}
