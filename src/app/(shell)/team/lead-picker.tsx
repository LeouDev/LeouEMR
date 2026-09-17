"use client";

import { useNavigation } from "@/components/navigation-progress";
import type { Granularity } from "@/lib/queries/period";

/**
 * Which team lead's roster to show.
 *
 * Three shapes for three situations, per the brief: an administrator picks
 * from a list of every lead, a manager with several leads gets them as
 * buttons — a span is a handful of people, and reading them at a glance is
 * the point — and a manager with exactly one lead gets no control at all,
 * because a picker with a single option is a decoration.
 *
 * The choice lives in the URL rather than in state, so a roster can be
 * linked to and survives a refresh, and so the server renders the team
 * instead of the client re-fetching it. Navigation goes through the shared
 * progress bar: changing lead re-aggregates a whole period server-side, and
 * a control that gives no sign it heard the click is the one complaint the
 * period picker was built to answer.
 */
export function LeadPicker({
  leads,
  selected,
  granularity,
  period,
  mode,
}: {
  leads: string[];
  selected: string;
  granularity: Granularity;
  /** The selected period's start, carried so switching lead does not reset it. */
  period: string;
  mode: "select" | "tabs" | "none";
}) {
  const { navigate, pending } = useNavigation();

  function go(lead: string) {
    const params = new URLSearchParams({ lead, granularity, period });
    navigate(`/team?${params.toString()}`);
  }

  if (mode === "none") {
    return <div className="text-[15px] font-extrabold text-ink">{selected}&rsquo;s team</div>;
  }

  if (mode === "tabs") {
    return (
      <div
        className={`flex flex-wrap border-2 border-ink transition-opacity ${pending ? "opacity-60" : ""}`}
        aria-busy={pending}
      >
        {leads.map((lead) => (
          <button
            key={lead}
            type="button"
            disabled={pending}
            onClick={() => go(lead)}
            aria-pressed={lead === selected}
            className={`px-[18px] py-2.5 text-[13px] font-bold transition ${
              lead === selected ? "bg-orange-brand text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
            }`}
          >
            {lead}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-baseline gap-3 transition-opacity ${pending ? "opacity-60" : ""}`}
      aria-busy={pending}
    >
      <label
        htmlFor="team-lead"
        className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase"
      >
        Team lead
      </label>
      <select
        id="team-lead"
        value={selected}
        disabled={pending}
        onChange={(event) => go(event.target.value)}
        className="border-2 border-ink bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none"
      >
        {leads.map((lead) => (
          <option key={lead} value={lead}>
            {lead}
          </option>
        ))}
      </select>
    </div>
  );
}
