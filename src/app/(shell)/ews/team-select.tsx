"use client";

import { useNavigation } from "@/components/navigation-progress";
import type { EwsTeam } from "@/lib/queries/ews";

/**
 * The URL-driven filters over an EWS screen: which team (for a viewer with
 * more than one) and, where the screen has one, which year or month. Each
 * change is a navigation through the shared progress bar, like the period
 * picker: the server renders the narrowed screen and the URL can be shared.
 */
export function EwsFilters({
  basePath,
  teams,
  team,
  year,
  years,
  month,
  months,
}: {
  basePath: string;
  teams: EwsTeam[];
  team: string | null;
  /** The headcount year picker; omitted on the other screens. */
  year?: number;
  years?: number[];
  /** The attrition month picker: `all` or `YYYY-MM`. */
  month?: string;
  months?: Array<{ value: string; label: string }>;
}) {
  const { navigate, pending } = useNavigation();

  function go(next: { team?: string | null; year?: number; month?: string }) {
    const params = new URLSearchParams();
    const t = next.team === undefined ? team : next.team;
    const y = next.year ?? year;
    const m = next.month ?? month;
    if (t) params.set("team", t);
    if (y !== undefined) params.set("year", String(y));
    if (m !== undefined && m !== "all") params.set("month", m);
    const query = params.toString();
    navigate(query ? `${basePath}?${query}` : basePath);
  }

  const select = "border-2 border-ink bg-surface px-2.5 py-[7px] text-[13px] font-semibold text-ink outline-none disabled:opacity-60";
  const label = "text-[11px] font-bold tracking-[0.1em] text-muted uppercase";

  return (
    <div className={`flex flex-wrap items-center gap-5 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      {years && year !== undefined && (
        <label className="flex items-center gap-2.5">
          <span className={label}>Year</span>
          <select value={year} disabled={pending} onChange={(e) => go({ year: Number(e.target.value) })} className={select}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}
      {months && month !== undefined && (
        <label className="flex items-center gap-2.5">
          <span className={label}>Month</span>
          <select value={month} disabled={pending} onChange={(e) => go({ month: e.target.value })} className={select}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {teams.length > 1 && (
        <label className="flex items-center gap-2.5">
          <span className={label}>Team</span>
          <select value={team ?? ""} disabled={pending} onChange={(e) => go({ team: e.target.value || null })} className={select}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.supervisorEid} value={t.supervisorEid}>
                {t.supervisorName}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
