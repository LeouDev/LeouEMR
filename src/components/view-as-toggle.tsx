"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setViewAs } from "@/app/(shell)/view-as/actions";
import { describeActionError } from "@/lib/ui/action-error";

/**
 * The administrator's switch between their own view and a manager's: two
 * buttons, and the manager name to stand as when the second is chosen.
 * Lands on the dashboard after a switch, since the page it was pressed
 * on may not exist for the other role.
 */
export function ViewAsToggle({
  current,
  managerNames,
  onNavigate,
}: {
  /** The manager name in view, or null for the administrator's own view. */
  current: string | null;
  managerNames: string[];
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(current ?? managerNames[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(managerName: string | null) {
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await setViewAs({ managerName });
    } catch (cause) {
      setError(describeActionError(cause));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onNavigate?.();
    router.push("/dashboard");
    router.refresh();
  }

  const segment = (active: boolean) =>
    `flex-1 px-3 py-2 text-xs font-semibold tracking-[0.08em] uppercase transition ${
      active ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
    } disabled:opacity-60`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex border-2 border-ink">
        <button type="button" disabled={busy || current === null} onClick={() => apply(null)} className={segment(current === null)} aria-pressed={current === null}>
          Admin
        </button>
        <button
          type="button"
          disabled={busy || managerNames.length === 0 || current === choice}
          onClick={() => apply(choice)}
          className={`border-l-2 border-ink ${segment(current !== null)}`}
          aria-pressed={current !== null}
        >
          Manager
        </button>
      </div>
      {managerNames.length > 0 ? (
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold tracking-[0.08em] text-ink-faint uppercase">View as manager</span>
          <select
            value={choice}
            disabled={busy}
            onChange={(e) => {
              setChoice(e.target.value);
              if (current !== null) void apply(e.target.value);
            }}
            className="w-full border-2 border-ink bg-surface px-2.5 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
          >
            {managerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[13px] text-ink-muted">No manager names in the imported data yet.</p>
      )}
      <p className="text-[11px] text-ink-faint">
        {current === null
          ? "As a manager you see that span's dashboard, teams and pages exactly as they do; switch back here."
          : `Viewing as ${current}. Administrator-only pages are hidden until you switch back.`}
      </p>
      {error && (
        <p role="alert" className="text-xs font-semibold text-fail">
          {error}
        </p>
      )}
    </div>
  );
}
