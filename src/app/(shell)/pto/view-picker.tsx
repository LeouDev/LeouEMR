import { NavLink } from "@/components/nav-link";
import type { CalendarView } from "@/lib/pto/scope";

export interface ViewTab {
  key: CalendarView;
  label: string;
}

/** A supervisor's choice: their own reports, or the whole cluster under their manager. */
export const SUPERVISOR_TABS: readonly ViewTab[] = [
  { key: "team", label: "My team" },
  { key: "cluster", label: "My cluster" },
];

/**
 * A manager's choice. Their span already is the cluster, so the split that
 * helps them is by kind of person: the agents' leave (cover for a floor) and
 * the team leaders' own leave (cover for a team) read differently.
 */
export const MANAGER_TABS: readonly ViewTab[] = [
  { key: "everyone", label: "Everyone" },
  { key: "agents", label: "Agents" },
  { key: "leaders", label: "Team leaders" },
];

/**
 * Switches the calendar between the views a role has. Only rendered when
 * there is more than one — an agent's team is all they have, and a
 * supervisor without a resolvable cluster has only their team.
 */
export function ViewPicker({
  month,
  view,
  tabs,
}: {
  month: string;
  view: CalendarView;
  tabs: readonly ViewTab[];
}) {
  return (
    <div className="flex border-2 border-ink">
      {tabs.map((tab, i) => (
        <NavLink
          key={tab.key}
          href={`/pto?${new URLSearchParams({ month, view: tab.key })}`}
          prefetch={false}
          className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${
            i > 0 ? "border-l-2 border-ink" : ""
          } ${view === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
