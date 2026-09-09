"use client";

import { useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/navigation-progress";
import type { Granularity } from "@/lib/queries/period";

const control =
  "border-2 border-ink bg-surface px-3 text-sm font-bold text-ink outline-none h-8";

/**
 * The one control on this page that needs real navigation-on-change rather
 * than being a plain link: a native `<select>` has nothing to submit itself
 * with once the Apply button is gone. Everything else here — tabs, the
 * period stepper, sort chips — stays a server-rendered link; this is the
 * page's only client-side sliver.
 */
export function GranularitySelect({
  granularity,
  options,
  labels,
}: {
  granularity: Granularity;
  options: readonly Granularity[];
  labels: Record<Granularity, string>;
}) {
  const { navigate, pending } = useNavigation();
  const searchParams = useSearchParams();

  return (
    <select
      aria-label="View by"
      value={granularity}
      disabled={pending}
      aria-busy={pending}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("granularity", e.target.value);
        // A different granularity re-derives the whole periods list, so the
        // previously selected period's start date almost never lines up
        // with one in the new list — better to land on the newest period
        // than silently fall through to index 0 with a stale, wrong label.
        next.delete("period");
        navigate(`?${next.toString()}`);
      }}
      className={control}
    >
      {options.map((g) => (
        <option key={g} value={g}>
          {labels[g]}
        </option>
      ))}
    </select>
  );
}
