"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearRampAssignment, setRampAssignment } from "./actions";
import { describeActionError } from "@/lib/ui/action-error";

export interface RampFormEmployee {
  id: string;
  eid: string;
  name: string;
}

export interface RampFormSkill {
  id: string;
  name: string;
}

/** Starts or corrects a ramp assignment. One shared form rather than one per row in the board. */
export function RampForm({
  employees,
  skills,
}: {
  employees: RampFormEmployee[];
  skills: RampFormSkill[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [skillReferenceId, setSkillReferenceId] = useState(skills[0]?.id ?? "");
  const [rampStartDate, setRampStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    let result;
    try {
      result = await setRampAssignment({ employeeId, skillReferenceId, rampStartDate });
    } catch (cause) {
      setMessage({ kind: "error", text: describeActionError(cause) });
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setMessage({
        kind: "ok",
        text:
          result.weeksCorrected > 0
            ? `Saved — ${result.weeksCorrected} already-imported week${result.weeksCorrected === 1 ? "" : "s"} corrected to match.`
            : "Saved.",
      });
      setRampStartDate("");
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-t-2 border-ink p-6 sm:grid-cols-[1fr_1fr_auto_auto]">
      <label className="block">
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Employee
        </span>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none"
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.eid}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Skill
        </span>
        <select
          value={skillReferenceId}
          onChange={(e) => setSkillReferenceId(e.target.value)}
          className="w-full border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none"
        >
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
          Nesting starts
        </span>
        <input
          type="date"
          required
          value={rampStartDate}
          onChange={(e) => setRampStartDate(e.target.value)}
          className="border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none"
        />
      </label>

      <div className="flex items-end">
        <button type="submit" disabled={busy || !employeeId || !skillReferenceId} className="btn-primary px-5 py-2.5 text-sm">
          {busy ? "Saving…" : "Start ramp"}
        </button>
      </div>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm font-semibold sm:col-span-4 ${message.kind === "error" ? "text-fail" : "text-pass"}`}
        >
          {message.text}
        </p>
      )}

      <p className="text-xs text-muted sm:col-span-4">
        Any day within the intended first week works — it snaps to that week&rsquo;s Saturday.
        Setting this again for the same employee and skill replaces the previous start date.
      </p>
    </form>
  );
}

/** Ends a ramp assignment early — the employee reverts to the skill's steady target immediately. */
export function ClearRampButton({
  employeeId,
  skillReferenceId,
}: {
  employeeId: string;
  skillReferenceId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clear() {
    if (!confirm("End this ramp assignment? The employee will be scored against the standard target from here on.")) {
      return;
    }
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await clearRampAssignment({ employeeId, skillReferenceId });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) router.refresh();
    // Inline, like every other form here — this used to be a browser
    // alert(), the one place in the app a refusal popped up as a modal.
    else setError(result.error);
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={clear}
        className="border-2 border-fail px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-fail uppercase transition hover:bg-fail-bg disabled:opacity-40"
      >
        {busy ? "Clearing…" : "Clear"}
      </button>
      {error && (
        <span role="alert" className="max-w-56 text-xs text-fail">
          {error}
        </span>
      )}
    </span>
  );
}
