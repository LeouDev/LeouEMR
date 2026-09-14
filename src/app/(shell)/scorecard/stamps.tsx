"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeActionError } from "@/lib/ui/action-error";
import { acknowledgeScorecard, reviewScorecard } from "./actions";

function Feedback({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
      {message}
    </p>
  );
}

/** The team leader's sign-off. Disabled with the reason until the month opens, or when nothing has changed since the last review. */
export function ReviewButton({
  employeeId,
  month,
  disabledReason,
  label,
}: {
  employeeId: string;
  month: string;
  disabledReason: string | null;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await reviewScorecard({ employeeId, month });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={review}
        disabled={busy || disabledReason !== null}
        title={disabledReason ?? undefined}
        className="btn-primary px-5 py-3 text-sm"
      >
        {busy ? "Saving…" : label}
      </button>
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      <Feedback message={error} />
    </div>
  );
}

/** The agent's acknowledgement, available once the team leader has reviewed. */
export function AcknowledgeButton({ month, disabledReason }: { month: string; disabledReason: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await acknowledgeScorecard({ month });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={acknowledge}
        disabled={busy || disabledReason !== null}
        title={disabledReason ?? undefined}
        className="btn-primary px-5 py-3 text-sm"
      >
        {busy ? "Recording…" : "Acknowledge"}
      </button>
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      <Feedback message={error} />
    </div>
  );
}
