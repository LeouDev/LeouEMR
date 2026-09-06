"use client";

import type { TrendGrain } from "@/lib/queries/analytics";

/**
 * Site, manager and the date range still need Apply — someone midway through
 * typing a date is not done just because a keystroke landed. The grain has
 * only two states and no typing involved, so picking one submits the form
 * immediately, carrying whatever else is currently in it, rather than making
 * the same choice take two clicks (pick it, then remember to apply it).
 */
export function TrendToggle({ grain }: { grain: TrendGrain }) {
  return (
    <div className="flex border-2 border-ink">
      {(["week", "month"] as const).map((option, i) => (
        <label
          key={option}
          className={`cursor-pointer px-4 py-2.5 text-sm font-semibold capitalize ${
            i > 0 ? "border-l-2 border-ink" : ""
          } ${grain === option ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"}`}
        >
          <input
            type="radio"
            name="grain"
            value={option}
            defaultChecked={grain === option}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="sr-only"
          />
          {option}
        </label>
      ))}
    </div>
  );
}
