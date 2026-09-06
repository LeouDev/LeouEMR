"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const control =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100";

export function RosterFilters({
  supervisors,
  sites,
  initial,
}: {
  supervisors: string[];
  sites: string[];
  initial: { q: string; supervisor: string; site: string; risk: string; standing: string };
}) {
  const router = useRouter();
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

    router.push(`/employees?${params.toString()}`);
  }

  const active = Object.values(values).some(Boolean);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply(values);
      }}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm"
    >
      <label className="min-w-56 flex-1">
        <span className="mb-1.5 block text-sm font-medium text-navy-800">Search</span>
        <input
          type="search"
          value={values.q}
          placeholder="Name, employee ID, supervisor or manager"
          onChange={(e) => setValues({ ...values, q: e.target.value })}
          className={`${control} w-full`}
        />
      </label>

      <label>
        <span className="mb-1.5 block text-sm font-medium text-navy-800">Supervisor</span>
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
        <span className="mb-1.5 block text-sm font-medium text-navy-800">Site</span>
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
        <span className="mb-1.5 block text-sm font-medium text-navy-800">Standing</span>
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
        <span className="mb-1.5 block text-sm font-medium text-navy-800">EWS risk</span>
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

      <button
        type="submit"
        className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-900"
      >
        Search
      </button>

      {active && (
        <button
          type="button"
          onClick={() => apply({ q: "", supervisor: "", site: "", risk: "", standing: "" })}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-navy-900"
        >
          Clear
        </button>
      )}
    </form>
  );
}
