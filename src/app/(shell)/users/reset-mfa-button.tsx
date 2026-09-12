"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetMfa } from "./actions";
import { describeActionError } from "@/lib/ui/action-error";

/** Removes someone's authenticator pairing, after a second click to confirm. */
export function ResetMfaButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await resetMfa({ userId });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setConfirming(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {confirming ? (
        <>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="text-xs font-semibold text-fail underline-offset-4 hover:underline"
            aria-label={`Confirm removing the authenticator for ${name}`}
          >
            {busy ? "Removing…" : "Confirm reset"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-xs text-muted underline-offset-4 hover:underline"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-muted underline-offset-4 hover:underline"
          aria-label={`Reset the authenticator for ${name}`}
        >
          Reset
        </button>
      )}
      {error && <span className="text-xs font-semibold text-fail">{error}</span>}
    </span>
  );
}
