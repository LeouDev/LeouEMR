"use client";

import { useRouter } from "next/navigation";
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  type Granularity,
  type Period,
} from "@/lib/queries/period";

/**
 * Granularity plus which period. Both live in the URL so a view can be
 * linked and shared, and so the server renders the selected period rather
 * than the client re-fetching.
 */
export function PeriodPicker({
  basePath,
  granularity,
  periods,
  selected,
  extraParams = {},
}: {
  basePath: string;
  granularity: Granularity;
  periods: Period[];
  selected: Period;
  extraParams?: Record<string, string | undefined>;
}) {
  const router = useRouter();

  function urlFor(next: { granularity?: Granularity; start?: string }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) params.set(key, value);
    }
    params.set("granularity", next.granularity ?? granularity);
    // Changing granularity drops the period so the server picks the newest
    // one of the new size, rather than carrying over a date that no longer
    // starts a valid period.
    if (next.start) params.set("period", next.start);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-line bg-surface p-0.5">
        {GRANULARITIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => router.push(urlFor({ granularity: option }))}
            aria-pressed={option === granularity}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              option === granularity ? "bg-navy-800 text-white" : "text-muted hover:text-navy-900"
            }`}
          >
            {GRANULARITY_LABELS[option]}
          </button>
        ))}
      </div>

      <select
        value={selected.start}
        onChange={(e) => router.push(urlFor({ start: e.target.value }))}
        aria-label={`${GRANULARITY_LABELS[granularity]} to show`}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100"
      >
        {periods.map((period) => (
          <option key={period.start} value={period.start}>
            {period.label}
          </option>
        ))}
      </select>

      <span className="text-xs text-muted">
        {selected.start === selected.end
          ? selected.start
          : `${selected.start} to ${selected.end}`}
      </span>
    </div>
  );
}
