"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelPto, decidePto, requestPto } from "./actions";

const field =
  "w-full border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

const TYPES = [
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick" },
  { value: "emergency", label: "Emergency" },
  { value: "bereavement", label: "Bereavement" },
  { value: "unpaid", label: "Unpaid" },
] as const;

/** An agent's own request form. */
export function RequestForm() {
  const router = useRouter();
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("vacation");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | "pending" | "approved">(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);

    // An end date left blank almost always means a single day off.
    // Cleared in a finally: a server action that rejects rather than returning
    // an error would otherwise leave the button disabled until a page reload.
    let result;
    try {
      result = await requestPto({ startDate, endDate: endDate || startDate, type, reason });
    } catch {
      setBusy(false);
      setError("Could not submit that request. Please try again.");
      return;
    }
    setBusy(false);

    if (result.ok) {
      setSaved(result.approved ? "approved" : "pending");
      setStart("");
      setEnd("");
      setReason("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 p-6 sm:grid-cols-2">
      <label className="block">
        <span className={label}>First day</span>
        <input type="date" required value={startDate} onChange={(e) => setStart(e.target.value)} className={field} />
      </label>
      <label className="block">
        <span className={label}>Last day</span>
        <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} className={field} />
        <span className="mt-1 block text-xs text-muted">Leave blank for a single day.</span>
      </label>

      <label className="block">
        <span className={label}>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={field}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={label}>Reason (optional)</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </label>

      {error && (
        <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail sm:col-span-2">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="border-2 border-pass bg-pass-bg px-4 py-3 text-sm font-semibold text-pass sm:col-span-2">
          {saved === "approved"
            ? "Approved and added to the calendar."
            : "Request submitted. The leader over you will review it."}
        </p>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="btn-primary px-5 py-3 text-sm">
          {busy ? "Submitting…" : "Request time off"}
        </button>
      </div>
    </form>
  );
}

/** Approve / deny controls, shown only to someone who may decide. */
export function DecisionButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function decide(decision: "approved" | "denied") {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await decidePto({ requestId, decision, note });
    } catch {
      setBusy(false);
      setError("Could not record that decision. Please try again.");
      return;
    }
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        type="text"
        value={note}
        placeholder="Note (optional)"
        onChange={(e) => setNote(e.target.value)}
        aria-label="Decision note"
        className="w-48 border-2 border-ink bg-surface px-2 py-1 text-xs text-ink outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("approved")}
          className="bg-pass px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-white uppercase transition hover:opacity-90 disabled:opacity-40"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("denied")}
          className="border-2 border-fail px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-fail uppercase transition hover:bg-fail-bg disabled:opacity-40"
        >
          Deny
        </button>
      </div>
      {error && <p className="text-xs text-fail">{error}</p>}
    </div>
  );
}

/** Withdraw control for the requester's own row, or a leader's cancel on someone they decide for. */
export function CancelButton({ requestId, label = "Withdraw" }: { requestId: string; label?: string }) {
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
          let result;
          try {
            result = await cancelPto(requestId);
          } catch {
            setBusy(false);
            return;
          }
          setBusy(false);
          if (result.ok) router.refresh();
          else setError(result.error);
        }}
        className="border-2 border-ink px-3 py-1 text-xs font-bold tracking-[0.08em] text-ink uppercase transition hover:bg-orange-brand-100 disabled:opacity-40"
      >
        {label}
      </button>
      {error && <span className="text-xs text-fail">{error}</span>}
    </span>
  );
}
