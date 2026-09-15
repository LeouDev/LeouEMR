"use client";

import { useState } from "react";
import {
  BOXES,
  BOX_META,
  calendarCells,
  dayLabel,
  dayLongLabel,
  daySummary,
  monthLabel,
  monthStartOfDay,
  shiftMonth,
} from "@/lib/my-space/board";
import type { SavedDay } from "@/lib/queries/my-space";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The saved days, in a panel from the right: a month calendar marking the
 * days with a snapshot, the same days as a list, and the one picked shown
 * read-only beneath. Closing the panel forgets the pick.
 */
export function HistoryPanel({ days, today, onClose }: { days: SavedDay[]; today: string; onClose: () => void }) {
  const [monthStart, setMonthStart] = useState(monthStartOfDay(today));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const savedDays = new Set(days.map((d) => d.day));
  const cells = calendarCells(monthStart, savedDays, today, selectedDay);
  const selected = days.find((d) => d.day === selectedDay) ?? null;

  return (
    <>
      <div className="fixed inset-0 z-40 animate-[fadeIn_.2s_ease] bg-navy-900/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="History"
        className="fixed inset-y-0 right-0 z-[41] flex w-[380px] max-w-[92vw] animate-[slideInRight_.25s_ease] flex-col border-l-2 border-ink bg-surface"
      >
        <div className="flex items-center justify-between border-b-2 border-ink bg-navy-800 px-5 py-[18px]">
          <h2 className="text-[17px] font-extrabold text-cream">History</h2>
          <button type="button" onClick={onClose} aria-label="Close history" className="text-lg text-cream hover:text-orange-brand">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-[18px]">
          <div className="mb-2.5 flex items-center justify-between">
            <button type="button" onClick={() => setMonthStart((m) => shiftMonth(m, -1))} aria-label="Previous month" className="text-[15px] font-bold text-ink">
              ‹
            </button>
            <span className="text-xs font-bold tracking-[0.06em] text-ink uppercase">{monthLabel(monthStart)}</span>
            <button type="button" onClick={() => setMonthStart((m) => shiftMonth(m, 1))} aria-label="Next month" className="text-[15px] font-bold text-ink">
              ›
            </button>
          </div>
          <div className="mb-4 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((label, index) => (
              <span key={index} className="text-center text-[10px] text-ink-faint" aria-hidden="true">
                {label}
              </span>
            ))}
            {cells.map((cell) =>
              cell.day === null ? (
                <span key={cell.key} className="h-[30px]" aria-hidden="true" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!cell.saved}
                  onClick={() => setSelectedDay(cell.day)}
                  aria-label={`${dayLabel(cell.day)}${cell.saved ? ", saved" : ""}`}
                  aria-pressed={cell.selected}
                  className={[
                    "h-[30px] text-[11px]",
                    cell.today ? "border-2 border-orange-brand" : "border-[1px] border-line",
                    cell.selected ? "bg-navy-800 text-cream" : cell.saved ? "bg-orange-brand-100 text-ink" : "bg-surface text-ink",
                    cell.saved ? "cursor-pointer font-extrabold" : "cursor-default",
                  ].join(" ")}
                >
                  {cell.label}
                </button>
              ),
            )}
          </div>

          {days.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">No saved days yet. Hit &quot;Save day&quot; to start your history.</p>
          ) : (
            <>
              <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Recent</p>
              <ul>
                {days.map((d) => (
                  <li key={d.day}>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(d.day)}
                      aria-pressed={d.day === selectedDay}
                      className={`block w-full border-b-[1px] border-line px-1 py-2.5 text-left ${d.day === selectedDay ? "bg-orange-brand-100" : "bg-transparent"}`}
                    >
                      <span className="block text-[13px] font-bold text-ink">{dayLabel(d.day)}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">{daySummary(d.boxes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selected && (
            <div className="mt-[18px] border-t-2 border-ink pt-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[13px] font-extrabold text-ink">{dayLongLabel(selected.day)}</span>
                <button type="button" onClick={() => setSelectedDay(null)} className="text-xs text-muted underline hover:text-ink">
                  Close
                </button>
              </div>
              {BOXES.map((box) => (
                <div key={box}>
                  <p className="mt-2.5 mb-1 text-[11px] font-bold text-muted uppercase">{BOX_META[box].title}</p>
                  {selected.boxes[box].length === 0 ? (
                    <p className="mb-1 text-xs text-ink-faint">Nothing</p>
                  ) : (
                    selected.boxes[box].map((item) => (
                      <p key={item.id} className={`mb-1 text-xs break-words ${item.complete ? "text-ink-faint line-through" : "text-ink"}`}>
                        {item.text}
                        {item.note && <span className="text-ink-faint"> · {item.note}</span>}
                      </p>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
