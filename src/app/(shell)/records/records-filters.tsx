"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/navigation-progress";
import { STATUS_LABELS } from "@/components/ui";

const control = "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

export interface RecordsFilterValues {
  q: string;
  status: string;
  sort: "newest" | "oldest";
}

/** Filters live in the URL so a filtered archive can be linked and shared, same as the roster's. */
export function RecordsFilters({
  statuses,
  initial,
}: {
  statuses: readonly string[];
  initial: RecordsFilterValues;
}) {
  const { navigate, pending } = useNavigation();
  const searchParams = useSearchParams();
  const [values, setValues] = useState(initial);

  function apply(next: RecordsFilterValues) {
    setValues(next);
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries({ q: next.q, status: next.status, sort: next.sort })) {
      // Newest first is the default, so it needs no parameter of its own.
      if (value && !(key === "sort" && value === "newest")) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    navigate(query ? `/records?${query}` : "/records");
  }

  const active = values.q !== "" || values.status !== "" || values.sort !== "newest";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply(values);
      }}
      aria-busy={pending}
      className={`flex flex-wrap items-end gap-3 border-2 border-ink bg-surface p-4 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      <label className="min-w-56 flex-1">
        <span className={label}>Search employee</span>
        <input
          type="search"
          value={values.q}
          placeholder="Employee name"
          onChange={(e) => setValues({ ...values, q: e.target.value })}
          className={`${control} w-full`}
        />
      </label>

      <label>
        <span className={label}>Status</span>
        <select
          value={values.status}
          onChange={(e) => apply({ ...values, status: e.target.value })}
          className={control}
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status] ?? status}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className={label}>Date</span>
        <select
          value={values.sort}
          onChange={(e) => apply({ ...values, sort: e.target.value === "oldest" ? "oldest" : "newest" })}
          className={control}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>

      <button type="submit" disabled={pending} className="btn-primary px-5 py-3 text-sm">
        {pending ? "Searching…" : "Search"}
      </button>

      {active && (
        <button
          type="button"
          onClick={() => apply({ q: "", status: "", sort: "newest" })}
          className="border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          Clear
        </button>
      )}
    </form>
  );
}
