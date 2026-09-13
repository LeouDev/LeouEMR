import { NavLink } from "@/components/nav-link";
import { PageBand } from "@/components/ui";
import { AUDITS_PER_AGENT } from "@/lib/quality/week";

export type QualityTab = "dashboard" | "new" | "history" | "analysis";

const TABS: Array<{ key: QualityTab; href: string; label: string }> = [
  { key: "dashboard", href: "/quality", label: "Dashboard" },
  { key: "new", href: "/quality/new", label: "New audit" },
  { key: "history", href: "/quality/history", label: "History" },
  { key: "analysis", href: "/quality/analysis", label: "Team QA analysis" },
];

export function QualityBand() {
  return (
    <PageBand
      title="Quality Audit"
      subtitle={`Conduct agent audits and track weekly completion — ${AUDITS_PER_AGENT} per active agent per week`}
    />
  );
}

/** The four screens, as a tab strip under the band. */
export function QualityTabs({ active }: { active: QualityTab }) {
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

/** A small uppercase tag, in the app's status colours. */
export function Tag({ tone, children }: { tone: "pass" | "warn" | "fail" | "muted" | "ink"; children: React.ReactNode }) {
  const classes = {
    pass: "bg-pass-bg text-pass",
    warn: "bg-warn-bg text-warn",
    fail: "bg-fail-bg text-fail",
    muted: "bg-line text-muted",
    ink: "bg-ink text-white",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-1 text-[11px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${classes}`}>
      {children}
    </span>
  );
}
