import { NavLink } from "@/components/nav-link";
import { PageBand } from "@/components/ui";

/**
 * The ramp screens, as a tab strip under the band.
 *
 * Two routes rather than one page with a switch, matching Quality. Each tab
 * is a real address a reader can bookmark or send to someone, the back link
 * from an action item can name the one it came from — and, the part that
 * matters most here, a tab only runs its own queries. The progression is
 * the heaviest read in the app; somebody opening the board to set a start
 * date should not pay for it.
 */
export type RampTab = "board" | "progression";

const TABS: Array<{ key: RampTab; href: string; label: string }> = [
  { key: "board", href: "/ramp", label: "Board" },
  { key: "progression", href: "/ramp/progression", label: "Progression by stage" },
];

export function RampBand() {
  return (
    <PageBand
      title="New-Hire Ramp"
      subtitle="Two nesting weeks, then Week 1 through Week 8, to the standard target"
    />
  );
}

export function RampTabs({ active }: { active: RampTab }) {
  return (
    <div className="mb-6 inline-flex flex-wrap border-2 border-ink">
      {TABS.map((tab, i) => (
        <NavLink
          key={tab.key}
          href={tab.href}
          prefetch={false}
          className={`px-4 py-2 text-xs font-semibold tracking-[0.08em] uppercase ${i > 0 ? "border-l-2 border-ink" : ""} ${
            active === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
          }`}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
