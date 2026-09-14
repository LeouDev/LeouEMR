"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Signature } from "@/lib/scorecard/signature";
import { describeActionError } from "@/lib/ui/action-error";
import { acknowledgeScorecard, reviewScorecard } from "./actions";
import { SignatureDialog } from "./signature-dialog";

/**
 * A stamp button: click, sign in the dialog, confirm. The dialog stays
 * open on an error so the signature is not lost to a retry.
 */
function StampButton({
  label,
  disabledReason,
  dialogTitle,
  dialogPrompt,
  confirmLabel,
  busyLabel,
  submit,
}: {
  label: string;
  disabledReason: string | null;
  dialogTitle: string;
  dialogPrompt: string;
  confirmLabel: string;
  busyLabel: string;
  submit: (signature: Signature) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(signature: Signature) {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await submit(signature);
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabledReason !== null}
        title={disabledReason ?? undefined}
        className="btn-primary px-5 py-3 text-sm"
      >
        {busy ? busyLabel : label}
      </button>
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      {open && (
        <SignatureDialog
          title={dialogTitle}
          prompt={dialogPrompt}
          confirmLabel={confirmLabel}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => {
            if (!busy) setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The team leader's sign-off. Disabled with the reason until the month opens, or when nothing has changed since the last review. */
export function ReviewButton({
  employeeId,
  employeeName,
  month,
  monthLabel,
  disabledReason,
  label,
}: {
  employeeId: string;
  employeeName: string;
  month: string;
  monthLabel: string;
  disabledReason: string | null;
  label: string;
}) {
  return (
    <StampButton
      label={label}
      disabledReason={disabledReason}
      dialogTitle={`Sign off ${monthLabel} for ${employeeName}`}
      dialogPrompt="Your signature confirms you have reviewed this scorecard and discussed the goals and their definitions with the agent."
      confirmLabel="Sign and mark as reviewed"
      busyLabel="Saving…"
      submit={(signature) => reviewScorecard({ employeeId, month, signature })}
    />
  );
}

/** The agent's acknowledgement, available once the team leader has reviewed. */
export function AcknowledgeButton({
  month,
  monthLabel,
  disabledReason,
}: {
  month: string;
  monthLabel: string;
  disabledReason: string | null;
}) {
  return (
    <StampButton
      label="Acknowledge"
      disabledReason={disabledReason}
      dialogTitle={`Acknowledge your ${monthLabel} scorecard`}
      dialogPrompt="I acknowledge that performance goals and their definitions were clearly discussed to me by my Immediate Manager."
      confirmLabel="Sign and acknowledge"
      busyLabel="Recording…"
      submit={(signature) => acknowledgeScorecard({ month, signature })}
    />
  );
}
