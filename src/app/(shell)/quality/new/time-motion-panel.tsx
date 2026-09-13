"use client";

import {
  draftRows,
  filledCount,
  formatDelta,
  totals,
  type TimeMotionDraft,
  type TimeMotionSpec,
} from "@/lib/quality/time-motion";

const control = "w-full border-2 border-ink bg-surface px-2 py-1.5 text-sm text-ink outline-none";
const label = "mb-1 block text-[10px] font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * The Time & Motion side panel: a floating toggle in the corner while the
 * QA steps are scored, and a panel with one row per call segment —
 * baseline (editable), actual, and the delta between them. Not part of
 * the score; required in full before the audit can be filed.
 */
export function TimeMotionPanel({
  spec,
  draft,
  open,
  onToggle,
  onChange,
}: {
  spec: TimeMotionSpec;
  draft: TimeMotionDraft;
  open: boolean;
  onToggle: () => void;
  onChange: (next: TimeMotionDraft) => void;
}) {
  const rows = draftRows(spec, draft);
  const filled = filledCount(spec, draft);
  const total = totals(rows);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="fixed right-6 bottom-6 z-40 border-2 border-ink bg-ink px-4 py-3 text-xs font-bold tracking-[0.06em] text-white uppercase hover:bg-navy-800"
      >
        Time &amp; Motion · {filled}/{spec.segments.length}
      </button>

      {open && (
        <aside
          role="dialog"
          aria-label="Time and Motion"
          className="fixed top-20 right-6 bottom-20 z-40 w-[340px] max-w-[92vw] overflow-y-auto border-2 border-ink bg-surface shadow-[-4px_4px_0_rgba(0,0,0,0.1)]"
        >
          <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-4 py-3">
            <p className="text-sm font-bold text-ink">Time &amp; Motion</p>
            <button type="button" onClick={onToggle} aria-label="Close" className="btn-secondary px-2 py-0.5 text-sm">
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-3.5 p-4">
            <p className="text-xs text-muted">
              Log this alongside the QA scoring — not counted toward the score. Baselines are editable per audit.
            </p>
            <label>
              <span className={label}>Call reference</span>
              <input
                type="text"
                value={draft.callReference}
                maxLength={120}
                placeholder="e.g. REC-88213"
                onChange={(e) => onChange({ ...draft, callReference: e.target.value })}
                className={control}
              />
            </label>
            {rows.map((row, i) => (
              <div key={row.label} className="border-t-2 border-line pt-2.5">
                <p className="text-xs font-semibold text-ink">{row.label}</p>
                <div className="mt-1.5 flex items-end gap-2">
                  <label className="flex-1">
                    <span className={label}>Baseline (s)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={draft.baselines[row.label] ?? String(spec.segments[i].baseline)}
                      onChange={(e) => onChange({ ...draft, baselines: { ...draft.baselines, [row.label]: e.target.value } })}
                      className={`${control} font-mono`}
                    />
                  </label>
                  <label className="flex-1">
                    <span className={label}>Actual (s)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={draft.actuals[row.label] ?? ""}
                      onChange={(e) => onChange({ ...draft, actuals: { ...draft.actuals, [row.label]: e.target.value } })}
                      className={`${control} font-mono`}
                    />
                  </label>
                </div>
                <p
                  className={`mt-1.5 text-xs font-semibold ${
                    row.delta === null ? "text-muted" : row.delta > 0 ? "text-fail" : "text-pass"
                  }`}
                >
                  {row.delta === null ? "—" : formatDelta(row.delta)}
                </p>
              </div>
            ))}
            <div className="flex justify-between border-t-2 border-ink pt-2.5 text-sm font-bold text-ink">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {total.actual === null ? "—" : `${total.actual}s`} / {total.baseline}s
              </span>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
