"use client";

import { useRouter } from "next/navigation";
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  type Granularity,
  type Period,
} from "@/lib/queries/period";

/**
 * Remembered so Dashboard, MBO and Stack Rank — the three pages that share
 * this control — open on whatever period you last picked on any of them,
 * instead of each one silently resetting to its own default and making you
 * reselect. A page-scoped query param still wins whenever one is present, so
 * a shared link or the browser's back button still shows exactly what they
 * captured; this cookie only fills in when a page has nothing to go on.
 */
const GRANULARITY_COOKIE = "periodGranularity";
const START_COOKIE = "periodStart";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

function remember(granularity: Granularity, start?: string) {
  const attrs = `path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  document.cookie = `${GRANULARITY_COOKIE}=${granularity}; ${attrs}`;
  // Only written when a specific period was actually chosen. A date that
  // started a week does not start a month — pairing the old one with the new
  // granularity would remember something that was never picked.
  if (start) document.cookie = `${START_COOKIE}=${start}; ${attrs}`;
}

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

  function go(next: { granularity?: Granularity; start?: string }) {
    remember(next.granularity ?? granularity, next.start);
    router.push(urlFor(next));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex border-2 border-ink bg-surface p-0.5">
        {GRANULARITIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => go({ granularity: option })}
            aria-pressed={option === granularity}
            className={`px-2.5 py-1 text-xs font-medium transition ${option === granularity ? "bg-ink text-white" : "text-ink hover:bg-orange-brand-100"
            }`}
          >
            {GRANULARITY_LABELS[option]}
          </button>
        ))}
      </div>

      <select
        value={selected.start}
        onChange={(e) => go({ start: e.target.value })}
        aria-label={`${GRANULARITY_LABELS[granularity]} to show`}
        className="border-2 border-ink bg-surface px-3 py-1.5 text-sm text-ink outline-none transition"
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
