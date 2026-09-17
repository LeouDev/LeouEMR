"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeActionError } from "@/lib/ui/action-error";
import { reapplyAllRamps } from "./actions";

/**
 * Re-applies every ramp on the board to the current schedule, after a
 * second click to confirm. For after the schedule changes: every ramping
 * agent's already-imported weeks follow it at once.
 */
export function ReapplyAllButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "fail" } | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    let result;
    try {
      result = await reapplyAllRamps();
    } catch (cause) {
      setMessage({ text: describeActionError(cause), tone: "fail" });
      return;
    } finally {
      setBusy(false);
      setConfirming(false);
    }
    if (result.ok) {
      setMessage({
        text: `Re-applied ${result.assignments} ramp${result.assignments === 1 ? "" : "s"} · ${result.weeksCorrected} stored week${result.weeksCorrected === 1 ? "" : "s"} corrected`,
        tone: "ok",
      });
      router.refresh();
    } else {
      setMessage({ text: result.error, tone: "fail" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm text-ink">Re-apply every ramp to the current schedule?</span>
          <button type="button" onClick={run} disabled={busy} className="btn-primary px-4 py-2 text-sm">
            {busy ? "Re-applying…" : "Yes, re-apply"}
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
          Re-apply all ramps
        </button>
      )}
      {message && (
        <p role={message.tone === "fail" ? "alert" : "status"} className={`text-xs ${message.tone === "fail" ? "font-semibold text-fail" : "text-pass"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
