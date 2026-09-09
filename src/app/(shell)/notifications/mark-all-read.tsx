"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAllRead } from "./actions";
import { describeActionError } from "@/lib/ui/action-error";

export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          let result;
          try {
            result = await markAllRead();
          } catch (cause) {
            setError(describeActionError(cause));
            return;
          } finally {
            setBusy(false);
          }
          // The action refuses (rather than throws) when the session has
          // lapsed; refreshing on that would just redraw the same unread rows.
          if (!result.ok) {
            setError("Your session is no longer active — sign in again to update your inbox.");
            return;
          }
          router.refresh();
        }}
        className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand disabled:opacity-50"
      >
        {busy ? "Marking…" : "Mark all read"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-fail">
          {error}
        </span>
      )}
    </span>
  );
}
