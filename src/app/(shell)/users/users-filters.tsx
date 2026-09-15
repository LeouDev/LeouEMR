"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/navigation-progress";

const control = "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";

export const NO_POSITION = "none";

/** Filters live in the URL so a filtered view can be linked and shared, same as the roster's. */
export function UsersFilters({
  positions,
  value,
}: {
  /** The sign-up positions on offer, in the order the sign-up form lists them. */
  positions: readonly string[];
  value: { q: string; status: string; position: string };
}) {
  const { navigate, pending } = useNavigation();
  const searchParams = useSearchParams();
  // The search is typed, then applied on Enter (or blur), like the
  // archive's: applying on every keystroke would fire a navigation per
  // letter. The selects still apply at once.
  const [q, setQ] = useState(value.q);

  function apply(next: { q: string; status: string; position: string }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, v] of Object.entries(next)) {
      if (v) params.set(key, v);
      else params.delete(key);
    }
    const query = params.toString();
    navigate(query ? `/users?${query}` : "/users");
  }

  const active = value.q !== "" || value.status !== "" || value.position !== "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply({ ...value, q: q.trim() });
      }}
      aria-busy={pending}
      className={`flex flex-wrap items-end gap-3 border-2 border-ink bg-surface p-4 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      <label className="min-w-56 flex-1">
        <span className={label}>Search</span>
        <input
          type="search"
          value={q}
          placeholder="Name, email or employee ID"
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => {
            if (q.trim() !== value.q) apply({ ...value, q: q.trim() });
          }}
          className={`${control} w-full`}
        />
      </label>

      <label>
        <span className={label}>Status</span>
        <select
          value={value.status}
          onChange={(e) => apply({ ...value, q: q.trim(), status: e.target.value })}
          className={control}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <label>
        <span className={label}>Signed up as</span>
        <select
          value={value.position}
          onChange={(e) => apply({ ...value, q: q.trim(), position: e.target.value })}
          className={control}
        >
          <option value="">Any position</option>
          {positions.map((position) => (
            <option key={position} value={position}>
              {position}
            </option>
          ))}
          <option value={NO_POSITION}>No position given</option>
        </select>
      </label>

      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            apply({ q: "", status: "", position: "" });
          }}
          className="border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          Clear
        </button>
      )}
    </form>
  );
}
