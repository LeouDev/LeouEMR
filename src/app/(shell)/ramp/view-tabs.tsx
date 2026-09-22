import { NavLink } from "@/components/nav-link";

export type RampView = "progression" | "board";

export const RAMP_TABS: ReadonlyArray<{ key: RampView; label: string }> = [
  { key: "progression", label: "Progression by stage" },
  { key: "board", label: "Board" },
];

export function rampViewFor(value: string | undefined): RampView {
  return value === "board" ? "board" : "progression";
}

/**
 * The page's two tables, one at a time: how every cohort progressed, and who
 * is ramping today. In the URL so either tab can be linked to, and so the
 * server renders only the one being read — the progression is the larger
 * of the two and nobody reads both at once.
 */
export function RampViewTabs({ view }: { view: RampView }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Ramp view">
      {RAMP_TABS.map((tab) => (
        <NavLink
          key={tab.key}
          href={`/ramp?${new URLSearchParams({ view: tab.key })}`}
          prefetch={false}
          className={`border-2 border-ink px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase transition ${
            view === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
          }`}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
