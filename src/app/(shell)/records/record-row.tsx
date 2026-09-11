"use client";

import type { ReactNode } from "react";
import { useNavigation } from "@/components/navigation-progress";

/**
 * A table row that opens its record when clicked anywhere on it. The cells
 * still carry a real link to the same place, so the row works from the
 * keyboard and for anything that follows links rather than clicks.
 */
export function RecordRow({ href, children }: { href: string; children: ReactNode }) {
  const { navigate } = useNavigation();
  return (
    <tr
      onClick={(e) => {
        // A click that landed on a link inside the row is already a navigation.
        if ((e.target as HTMLElement).closest("a")) return;
        navigate(href);
      }}
      className="cursor-pointer border-b-2 border-line last:border-0 hover:bg-orange-brand-100"
    >
      {children}
    </tr>
  );
}
