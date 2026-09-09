"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatWeek } from "@/components/ui";
import { addRcaNote } from "../actions";
import { describeActionError } from "@/lib/ui/action-error";

export interface RcaNote {
  id: string;
  week: string;
  note: string;
  createdAt: Date;
  authorName: string | null;
}

/**
 * Dated notes against the root cause.
 *
 * The item carries one RCA describing the underlying problem; these record
 * how the circumstances changed over a long episode. Append-only, because
 * this is part of a performance record — a correction is another note, not an
 * edit that quietly rewrites what was said at the time.
 */
export function RcaNotes({
  actionItemId,
  notes,
  weeks,
  canAdd,
}: {
  actionItemId: string;
  notes: RcaNote[];
  /** The weeks this item spans, so a note cannot be filed against an unrelated one. */
  weeks: string[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const [week, setWeek] = useState(weeks[0] ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await addRcaNote({ actionItemId, week, note });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setNote("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div>
      {notes.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted">
          No notes yet. Add one when the circumstances behind the root cause change — the original
          RCA stays as the underlying explanation.
        </p>
      ) : (
        <ul className="divide-y-2 divide-line">
          {notes.map((n) => (
            <li key={n.id} className="px-6 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold tracking-[0.08em] text-orange-brand uppercase">
                  {formatWeek(n.week)}
                </span>
                <span className="text-xs text-muted">
                  {n.authorName ?? "Unknown"} ·{" "}
                  {/* Fixed timeZone: without one the server renders in UTC and the
                      browser in the viewer's zone, so the date can differ by a day
                      and React discards the server HTML as a hydration mismatch. */}
                  {n.createdAt.toLocaleDateString("en-US", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  })}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{n.note}</p>
            </li>
          ))}
        </ul>
      )}

      {canAdd && weeks.length > 0 && (
        <form onSubmit={submit} className="grid gap-3 border-t-2 border-ink p-6 sm:grid-cols-[12rem_1fr_auto]">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Week
            </span>
            <select
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="w-full border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none"
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {formatWeek(w)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              What changed
            </span>
            <input
              type="text"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. absences this week were illness, not the shift pattern"
              className="w-full border-2 border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>

          <div className="flex items-end">
            <button type="submit" disabled={busy} className="btn-secondary px-4 py-2.5 text-sm">
              {busy ? "Adding…" : "Add note"}
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-fail sm:col-span-3">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
