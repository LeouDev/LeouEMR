"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { approvePendingUsers } from "./actions";
import { describeActionError } from "@/lib/ui/action-error";

/**
 * Approves every pending account in the list on screen, after a second
 * click to confirm. The ids are the ones the page rendered, so what gets
 * approved is exactly what the administrator was looking at — a filtered
 * list approves only its own rows.
 */
export function ApprovePending({ userIds }: { userIds: string[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  if (userIds.length === 0) return null;
  const count = userIds.length;
  const noun = `${count} pending account${count === 1 ? "" : "s"}`;

  async function approve() {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await approvePendingUsers({ userIds });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setDone(result.approved);
      setConfirming(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm text-ink">Activate {noun}?</span>
          <button type="button" onClick={approve} disabled={busy} className="btn-primary px-4 py-2 text-sm">
            {busy ? "Approving…" : "Yes, approve"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
          >
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary px-4 py-2 text-sm">
          Approve all pending ({count})
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-fail">
          {error}
        </p>
      )}
      {done !== null && !error && (
        <p role="status" className="text-xs text-pass">
          Approved {done}
        </p>
      )}
    </div>
  );
}
