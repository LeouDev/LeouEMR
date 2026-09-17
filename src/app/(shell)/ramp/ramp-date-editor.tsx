"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeActionError } from "@/lib/ui/action-error";
import { setRampAssignment } from "./actions";

/**
 * The start date of one ramp assignment, editable in place. Save stores
 * the new date (snapped to the Sunday of its reporting week, as "Start
 * ramp" does) and replays the person's already-imported weeks against
 * it; Re-apply runs the same replay on the date as it stands, for after
 * the schedule itself has changed.
 */
export function RampDateEditor({
  employeeId,
  skillReferenceId,
  rampStartWeek,
}: {
  employeeId: string;
  skillReferenceId: string;
  rampStartWeek: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(rampStartWeek);
  const [busy, setBusy] = useState<"save" | "reapply" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "fail" } | null>(null);

  async function apply(rampStartDate: string, mode: "save" | "reapply") {
    setBusy(mode);
    setMessage(null);
    let result;
    try {
      result = await setRampAssignment({ employeeId, skillReferenceId, rampStartDate });
    } catch (cause) {
      setMessage({ text: describeActionError(cause), tone: "fail" });
      return;
    } finally {
      setBusy(null);
    }
    if (result.ok) {
      setMessage({
        text: `${mode === "save" ? "Saved" : "Re-applied"} · ${result.weeksCorrected} stored week${result.weeksCorrected === 1 ? "" : "s"} corrected`,
        tone: "ok",
      });
      router.refresh();
    } else {
      setMessage({ text: result.error, tone: "fail" });
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Nesting start date"
          className="border-2 border-ink bg-surface px-2 py-1 font-mono text-xs text-ink outline-none"
        />
        <button
          type="button"
          onClick={() => void apply(date, "save")}
          disabled={busy !== null || !date || date === rampStartWeek}
          className="bg-orange-brand px-3 py-1.5 text-xs font-bold text-white transition hover:bg-orange-brand-dark disabled:opacity-40"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void apply(rampStartWeek, "reapply")}
          disabled={busy !== null}
          title="Replay this person's imported weeks against the current schedule"
          className="border-2 border-ink bg-surface px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-orange-brand-100 disabled:opacity-40"
        >
          {busy === "reapply" ? "Re-applying…" : "Re-apply"}
        </button>
      </span>
      {message && (
        <span role={message.tone === "fail" ? "alert" : "status"} className={`max-w-64 text-xs ${message.tone === "fail" ? "text-fail" : "text-pass"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
