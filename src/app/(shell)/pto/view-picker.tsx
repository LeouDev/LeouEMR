import Link from "next/link";

const TABS = [
  { key: "team", label: "My team" },
  { key: "cluster", label: "My cluster" },
] as const;

/**
 * Switches the calendar between a supervisor's own reports and the whole
 * cluster under their manager.
 *
 * Only rendered when the two differ — a manager's team already is the
 * cluster, so offering the choice there would just be two identical views.
 */
export function ViewPicker({ month, view }: { month: string; view: "team" | "cluster" }) {
  return (
    <div className="flex border-2 border-ink">
      {TABS.map((tab, i) => (
        <Link
          key={tab.key}
          href={`/pto?${new URLSearchParams({ month, view: tab.key })}`}
          className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${
            i > 0 ? "border-l-2 border-ink" : ""
          } ${view === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
