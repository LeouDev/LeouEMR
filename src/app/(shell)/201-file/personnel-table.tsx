"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  STANDING_LABELS,
  displayName,
  filterPersonnel,
  filtersActive,
  formatAddress,
  personnelFacets,
  type PersonnelFilters,
  type PersonnelRow,
} from "@/lib/201-file/filter";

const control = "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none transition";
const label = "mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase";
const heading = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * The 201 file's list: a search box and filters that work as you type, and
 * a table that starts at twenty rows and grows as the page is scrolled.
 *
 * Every report in the leader's scope is already here, so nothing below
 * goes back to the server. The first twenty keep the page short for the
 * common case (one team, one name in mind); scrolling to the end of the
 * table reveals the next twenty, and a button does the same for anyone
 * whose browser does not report scrolling.
 */
export function PersonnelTable({ rows }: { rows: PersonnelRow[] }) {
  const [filters, setFilters] = useState<PersonnelFilters>(DEFAULT_FILTERS);
  const [shown, setShown] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  const { supervisors, sites } = useMemo(() => personnelFacets(rows), [rows]);
  const matches = useMemo(() => filterPersonnel(rows, filters), [rows, filters]);
  const registered = useMemo(() => rows.filter((r) => r.profile !== null).length, [rows]);

  const visible = matches.slice(0, shown);
  const more = matches.length > shown;
  const active = filtersActive(filters);

  /** A changed filter starts the list over at the top. */
  function apply(next: PersonnelFilters) {
    setFilters(next);
    setShown(PAGE_SIZE);
  }

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((n) => n + PAGE_SIZE);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, shown]);

  const subtitle =
    matches.length === 0
      ? "No one matches"
      : `Showing ${visible.length} of ${matches.length}` +
        (registered < rows.length ? ` · ${registered} of ${rows.length} have registered` : "");

  return (
    <>
      <form
        onSubmit={(event) => event.preventDefault()}
        className="mb-6 flex flex-wrap items-end gap-3 border-2 border-ink bg-surface p-4"
      >
        <label className="min-w-56 flex-1">
          <span className={label}>Search</span>
          <input
            type="search"
            value={filters.query}
            placeholder="Name, employee ID, MSID or email"
            onChange={(event) => apply({ ...filters, query: event.target.value })}
            className={`${control} w-full`}
          />
        </label>

        {supervisors.length > 1 && (
          <label>
            <span className={label}>Team leader</span>
            <select
              value={filters.supervisor}
              onChange={(event) => apply({ ...filters, supervisor: event.target.value })}
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
        )}

        {sites.length > 1 && (
          <label>
            <span className={label}>Site</span>
            <select
              value={filters.site}
              onChange={(event) => apply({ ...filters, site: event.target.value })}
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
        )}

        <label>
          <span className={label}>Standing</span>
          <select
            value={filters.standing}
            onChange={(event) => apply({ ...filters, standing: event.target.value as PersonnelFilters["standing"] })}
            className={control}
          >
            <option value="">Any</option>
            {(Object.keys(STANDING_LABELS) as (keyof typeof STANDING_LABELS)[]).map((standing) => (
              <option key={standing} value={standing}>
                {STANDING_LABELS[standing]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={label}>Show</span>
          <select
            value={filters.registration}
            onChange={(event) =>
              apply({ ...filters, registration: event.target.value as PersonnelFilters["registration"] })
            }
            className={control}
          >
            <option value="registered">Registered</option>
            <option value="unregistered">Not yet registered</option>
            <option value="all">Everyone</option>
          </select>
        </label>

        {active && (
          <button
            type="button"
            onClick={() => apply(DEFAULT_FILTERS)}
            className="border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
          >
            Clear
          </button>
        )}
      </form>

      <Card>
        <CardHeader title="Direct reports" subtitle={subtitle} />

        {rows.length === 0 ? (
          <EmptyState title="No direct reports" description="No one currently reports to you." />
        ) : matches.length === 0 ? (
          <EmptyState
            title={active ? "No one matches" : "No registered reports yet"}
            description={
              active
                ? "Try a shorter search, or clear the filters."
                : `${rows.length} people report to you, but none have signed up yet. Their 201 details appear here once they register.`
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="sticky left-0 z-10 bg-cream px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      Name
                    </th>
                    <th className={heading}>Employee ID</th>
                    <th className={heading}>MSID</th>
                    <th className={heading}>Position</th>
                    <th className={heading}>Email</th>
                    <th className={heading}>Phone</th>
                    <th className={heading}>Address</th>
                    <th className={`${heading} px-6`}>Emergency contact</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((report) => {
                    const p = report.profile;
                    const note = [report.site, report.standing !== "active" ? STANDING_LABELS[report.standing] : null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={report.id} className="border-b-2 border-line last:border-0 hover:bg-orange-brand-100">
                        <td className="sticky left-0 z-10 bg-surface px-6 py-2">
                          <Link
                            href={`/employees/${report.id}`}
                            prefetch={false}
                            className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                          >
                            {displayName(report)}
                          </Link>
                          {note && <p className="text-xs text-muted">{note}</p>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{report.eid}</td>
                        {p ? (
                          <>
                            <td className="px-3 py-2 font-mono text-xs text-muted">{p.msid ?? "—"}</td>
                            <td className="px-3 py-2 text-ink">{p.position}</td>
                            <td className="px-3 py-2 text-xs text-muted">{report.email ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted">{p.phoneNumber ?? "—"}</td>
                            <td className="max-w-64 px-3 py-2 text-xs text-muted">{formatAddress(p) || "—"}</td>
                            <td className="px-6 py-2 text-xs text-muted">
                              {p.emergencyContactName ? (
                                <>
                                  <span className="text-ink">{p.emergencyContactName}</span>
                                  {p.emergencyContactRelationship && ` (${p.emergencyContactRelationship})`}
                                  {p.emergencyContactNumber && (
                                    <span className="block font-mono">{p.emergencyContactNumber}</span>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          </>
                        ) : (
                          <td colSpan={6} className="px-3 py-2 text-xs text-muted italic">
                            Not registered yet — their details appear here once they sign up.
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {more && (
              <div ref={sentinel} className="flex items-center justify-center border-t-2 border-line px-6 py-4">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE_SIZE)}
                  className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
                >
                  Show {Math.min(PAGE_SIZE, matches.length - shown)} more
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
