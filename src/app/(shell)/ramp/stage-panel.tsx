"use client";

import Link from "next/link";
import { useEffect } from "react";
import { FROM_RAMP, withReturn } from "@/lib/development/return-to";
import type { StageDetail } from "@/lib/queries/ramp-progression";

/**
 * What the supervisor wrote about one agent during one stage of their ramp.
 *
 * A side panel rather than a page, because the question it answers is
 * "why is that cell red" — asked while reading the grid, and answered
 * without losing your place in it.
 *
 * Three kinds of thing, kept apart. The root cause and the plan belong to
 * the item and stand for its whole life; the notes are the genuinely
 * per-week part, written when that week differed from the original root
 * cause. Showing them as one block would make a plan written in March look
 * like a note about this week.
 *
 * Each category is shown above the prose it labels rather than beside it.
 * The category is the countable part — four stalls that were all Process
 * Refresher is a finding, where four paragraphs is reading — and a reader
 * scanning several weeks should get it without reading a word of the prose.
 */
export function StagePanel({
  agentName,
  stageLabel,
  detail,
  onClose,
}: {
  agentName: string;
  stageLabel: string;
  /** Null while the read is in flight — the panel opens first, then fills. */
  detail: StageDetail | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Clicking away closes it; the grid behind stays exactly where it was. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 cursor-default bg-ink/20"
      />

      <aside
        aria-label={`${agentName}, ${stageLabel}`}
        className="flex w-full max-w-md flex-col overflow-y-auto border-l-2 border-ink bg-surface"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-ink px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-ink">{agentName}</h2>
            <p className="mt-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {stageLabel}
              {detail?.week ? ` · week of ${detail.week}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-sm text-muted transition hover:text-ink"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {detail === null ? (
          <p className="px-5 py-6 text-sm text-muted">Loading…</p>
        ) : detail.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            {detail.week === null
              ? "This stage could not be matched to a week for this agent."
              : "No development item was open for this agent that week."}
          </p>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            {detail.items.map((item) => (
              <article key={item.actionItemId} className="border border-line px-3.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-ink">{item.kpiName}</h3>
                  {/* The code is the way to the item itself, for a reader who
                      reads the plan and then wants to change it. It carries
                      the ramp token so the item page sends them back here
                      rather than to a list they never came from. */}
                  <Link
                    href={withReturn(`/records/${item.actionItemId}`, FROM_RAMP)}
                    className="text-[10px] tracking-[0.06em] text-muted uppercase underline decoration-dotted underline-offset-4 transition hover:text-orange-brand hover:decoration-solid"
                  >
                    {item.actionItemCode} · opened {item.openedWeek}
                  </Link>
                </div>

                <Category>{item.rootCauseCategory}</Category>
                <Field label="Root cause">
                  {item.rootCauseDetails ?? item.problemStatement}
                </Field>
                <Category>{item.planCategory}</Category>
                <Field label="Action plan">{item.correctiveAction}</Field>
                <Field label="Expected behavior">{item.expectedBehavior}</Field>

                {item.notes.length > 0 && (
                  <div className="mt-2.5 border-t border-line pt-2.5">
                    <p className="text-[10px] font-semibold tracking-[0.08em] text-orange-brand uppercase">
                      Notes for this week
                    </p>
                    <ul className="mt-1 flex flex-col gap-1.5">
                      {item.notes.map((note, i) => (
                        <li key={i} className="text-xs leading-relaxed text-ink">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * The chosen category, as a chip above the prose it labels.
 *
 * Omitted entirely when there is none — an RCA not yet written, or a plan
 * from before the list existed. An empty chip would read as a category
 * somebody chose and left blank.
 */
function Category({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p className="mt-2.5">
      <span className="bg-orange-brand-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-ink uppercase">
        {children}
      </span>
    </p>
  );
}

/** Omitted rather than shown empty: a blank label reads as a missing answer. */
function Field({ label, children }: { label: string; children: string | null }) {
  if (!children) return null;
  return (
    <p className="mt-2 text-xs leading-relaxed text-muted">
      <strong className="text-ink">{label} — </strong>
      {children}
    </p>
  );
}
