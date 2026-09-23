"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

/**
 * "← Back": the page the reader came from, whichever it was.
 *
 * A person's page is reached from a dozen lists — the roster, MBO, EWS, the
 * stack rank, a scorecard, an action item — and a link fixed on one of them
 * sent everyone else somewhere they had not been. The browser already knows
 * the way back; this presses it. A shared link opened in a fresh tab has no
 * history entry to return to, and gets the fallback list instead.
 *
 * The history check is a store read rather than an effect so the server
 * render and the first client render agree (no history on the server), and
 * the button appears without a second paint.
 */
export function BackLink({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) {
  const router = useRouter();
  const canGoBack = useSyncExternalStore(
    () => () => {},
    () => window.history.length > 1,
    () => false,
  );
  const className = "text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline";

  if (!canGoBack) {
    return (
      <Link href={fallbackHref} className={className}>
        {fallbackLabel}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => router.back()} className={`cursor-pointer ${className}`}>
      ← Back
    </button>
  );
}
