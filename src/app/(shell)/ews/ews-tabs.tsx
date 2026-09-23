import { NavLink } from "@/components/nav-link";
import { PageBand } from "@/components/ui";

export type EwsTab = "team" | "headcount" | "attrition";

const TABS: Array<{ key: EwsTab; href: string; label: string }> = [
  { key: "team", href: "/ews", label: "My Team" },
  { key: "headcount", href: "/ews/headcount", label: "Headcount" },
  { key: "attrition", href: "/ews/attrition", label: "Permanent Attrition" },
];

/** The band every EWS screen sits under. */
export function EwsBand({ action }: { action?: React.ReactNode }) {
  return <PageBand title="Early Warning Signs" subtitle="Retention risk, headcount & attrition" action={action} />;
}

/**
 * The three screens as a tab strip under the band. The team a manager or
 * administrator has narrowed to travels with the tabs, so switching screen
 * keeps them on the same team.
 */
export function EwsTabs({ active, team }: { active: EwsTab; team: string | null }) {
  const suffix = team ? `?team=${encodeURIComponent(team)}` : "";
  return (
    <div className="mb-6 inline-flex flex-wrap border-2 border-ink">
      {TABS.map((tab, i) => (
        <NavLink
          key={tab.key}
          href={`${tab.href}${suffix}`}
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

/** A small uppercase tag in the app's status colours, for the tables' pills. */
export function Pill({ tone, children }: { tone: "pass" | "warn" | "fail" | "muted" | "ink" | "orange"; children: React.ReactNode }) {
  const classes = {
    pass: "bg-pass-bg text-pass",
    warn: "bg-warn-bg text-warn",
    fail: "bg-fail-bg text-fail",
    muted: "bg-line text-muted",
    ink: "bg-navy-900 text-white",
    orange: "bg-orange-brand-100 text-orange-brand-dark",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${classes}`}>
      {children}
    </span>
  );
}

export const HEAD = "px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase";
export const LABEL = "mb-1.5 block text-[11px] font-bold tracking-[0.04em] text-muted uppercase";
export const FIELD = "w-full border-2 border-ink bg-surface px-2.5 py-2 text-sm text-ink outline-none disabled:opacity-60";
