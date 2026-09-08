"use client";

import { useEffect } from "react";

/**
 * Catches a failed page load anywhere under the shell — a query that threw,
 * most often a database round trip that timed out — so it lands on a plain
 * "try again" message instead of a blank screen or a raw stack trace. Every
 * route here had no error boundary at all before this; the loading skeleton
 * beside this file covers the wait, this covers the wait not paying off.
 */
export default function ShellError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="border-2 border-fail bg-fail-bg px-6 py-12 text-center">
        <h2 className="text-lg font-bold text-fail">Something went wrong loading this page.</h2>
        <p className="mt-2 text-sm text-fail">
          This is usually temporary — try again in a moment. If it keeps happening, tell your administrator.
        </p>
        {error.digest && <p className="mt-1 text-xs text-fail opacity-70">Reference: {error.digest}</p>}
        <button type="button" onClick={() => retry()} className="btn-primary mt-6 px-5 py-2.5 text-sm">
          Try again
        </button>
      </div>
    </main>
  );
}
