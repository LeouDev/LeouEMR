"use client";

import { useEffect, useState } from "react";
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, hasInk, type Signature } from "@/lib/scorecard/signature";
import { SignaturePad } from "./signature-pad";

/**
 * The step between clicking a stamp and it being recorded: draw, then
 * confirm. Confirming an empty pad is not possible, so every stamp on a
 * card carries a signature.
 */
export function SignatureDialog({
  title,
  prompt,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  prompt: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (signature: Signature) => void;
  onCancel: () => void;
}) {
  const [strokes, setStrokes] = useState<number[][]>([]);
  const inked = hasInk({ strokes });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="signature-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-2xl border-2 border-ink bg-surface shadow-xl">
        <div className="border-b-2 border-ink px-6 py-4">
          <h2 id="signature-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">{prompt}</p>
        </div>
        <div className="px-6 py-4">
          <SignaturePad strokes={strokes} onChange={setStrokes} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Sign with your mouse, pen or finger. The date and time are recorded when you confirm.</span>
            <button
              type="button"
              onClick={() => setStrokes([])}
              disabled={busy || strokes.length === 0}
              className="text-sm font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 bg-fail-bg px-3 py-2 text-sm font-semibold text-fail">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t-2 border-ink px-6 py-4">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary px-5 py-3 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ w: SIGNATURE_WIDTH, h: SIGNATURE_HEIGHT, strokes })}
            disabled={busy || !inked}
            title={inked ? undefined : "Draw your signature first"}
            className="btn-primary px-5 py-3 text-sm"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
