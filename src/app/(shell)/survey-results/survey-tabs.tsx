import { NavLink } from "@/components/nav-link";

export type SurveyTab = "responses" | "utilization";

const TABS: Array<{ key: SurveyTab; href: string; label: string }> = [
  { key: "responses", href: "/survey-results", label: "Responses" },
  { key: "utilization", href: "/survey-results/utilization", label: "Utilization" },
];

/** The two administrator screens about how the tool is received and used. */
export function SurveyTabs({ active }: { active: SurveyTab }) {
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
