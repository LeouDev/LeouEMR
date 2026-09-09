"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNavigation } from "@/components/navigation-progress";

const control =
  "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition";

export function RosterFilters({
  supervisors,
  sites,
  initial,
}: {
  supervisors: string[];
  sites: string[];
  initial: { q: string; supervisor: string; site: string; risk: string; standing: string };
}) {
  const { navigate, pending } = useNavigation();
  const searchParams = useSearchParams();
  const [values, setValues] = useState(initial);

  /** Filters live in the URL so a filtered view can be linked and shared. */
  function apply(next: typeof values) {
    setValues(next);
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries({
      q: next.q,
      supervisor: next.supervisor,
      site: next.site,
      risk: next.risk,
      standing: next.standing,
    })) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    navigate(`/employees?${params.toString()}`);
  }

  const active = Object.values(values).some(Boolean);

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
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Search</span>
        <input
          type="search"
          value={values.q}
          placeholder="Name, employee ID, supervisor or manager"
          onChange={(e) => setValues({ ...values, q: e.target.value })}
          className={`${control} w-full`}
        />
      </label>

      <label>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Supervisor</span>
        <select
          value={values.supervisor}
          onChange={(e) => apply({ ...values, supervisor: e.target.value })}
          className={`${control} max-w-52`}
        >
          <option value="">All</option>
          {supervisors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Site</span>
        <select
          value={values.site}
          onChange={(e) => apply({ ...values, site: e.target.value })}
          className={control}
        >
          <option value="">All</option>
          {sites.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">Standing</span>
        <select
          value={values.standing}
          onChange={(e) => apply({ ...values, standing: e.target.value })}
          className={control}
        >
          <option value="">Any</option>
          <option value="failing">Failing this week</option>
          <option value="attention">Has open items</option>
          <option value="clear">Clear</option>
        </select>
      </label>

      <label>
        <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">EWS risk</span>
        <select
          value={values.risk}
          onChange={(e) => apply({ ...values, risk: e.target.value })}
          className={control}
        >
          <option value="">Any</option>
          <option value="GREEN">Stable</option>
          <option value="YELLOW">Watch</option>
          <option value="RED">At risk</option>
          <option value="BLACK">Critical</option>
        </select>
      </label>

      <button type="submit" disabled={pending} className="btn-primary px-5 py-3 text-sm">
        {pending ? "Searching…" : "Search"}
      </button>

      {active && (
        <button
          type="button"
          onClick={() => apply({ q: "", supervisor: "", site: "", risk: "", standing: "" })}
          className="border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          Clear
        </button>
      )}
    </form>
  );
}
