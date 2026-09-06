import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { HeaderScene } from "@/components/header-scene";
import { NavTabs } from "@/components/nav-tabs";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

/** Kept short: a wrapping role label was the widest thing in the header. */
const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Team Leader",
  agent: "Agent",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/action-items", label: "Action Items" },
  { href: "/development", label: "Development Hub" },
  { href: "/pto", label: "Time Off" },
  { href: "/stack-rank", label: "Stack Rank" },
];

/**
 * An agent works from their own numbers, not the shared configuration: the
 * skill reference is a scoring policy table they cannot change, so their
 * slot goes to their own stats instead.
 */
const AGENT_NAV = [{ href: "/my-stats", label: "My Tools" }];

/**
 * Leaders only. An agent's own MBO is on My Stats; the MBO page is a roster
 * of who is passing across a team, which is not theirs to read.
 */
const LEADER_ONLY_NAV = [
  { href: "/mbo", label: "MBO" },
  { href: "/skills", label: "Skills" },
  { href: "/ews", label: "EWS" },
  { href: "/ramp", label: "Ramp" },
];

/**
 * The team lead who actually works an agent's adherence exceptions day to
 * day; a manager or admin has no reason to see this in their own nav.
 */
const SUPERVISOR_ONLY_NAV = [{ href: "/adherence", label: "Adherence" }];

/** Only roles with direct reports; an agent's own details are not a 201 file. */
const LEADER_NAV = [{ href: "/201-file", label: "201 File" }];

/**
 * Admin-only destinations. The pages enforce this themselves too — Audit
 * has no nav entry (kept reachable by URL for whoever needs it) but is
 * otherwise unchanged.
 */
const ADMIN_NAV = [
  { href: "/import", label: "Import" },
  { href: "/users", label: "Users" },
];

/**
 * The application header: identity on top, navigation beneath.
 *
 * The tabs sit on their own row at every width rather than competing with the
 * mark and the account block for one line. With up to ten destinations they
 * could not fit beside the logo, and squeezing them made the row wrap into a
 * ragged two-line block. A single full-width strip scrolls sideways when it
 * has to and stays one clean line the rest of the time.
 *
 * Rendered once by the (shell) layout rather than by each page — which tab
 * is active comes from NavTabs reading the pathname itself, so this
 * component (and the animated scene inside it) never depends on the route
 * and is never recreated by navigating.
 */
export async function AppHeader({ user }: { user: CurrentUser }) {
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));

  // A supervisor's /skills tab has no configuration to reference — just the
  // rating and quality calculators — so it reads as "My Tools" for them
  // specifically, while a manager or admin still sees "Skills".
  const leaderNav = LEADER_ONLY_NAV.map((item) =>
    item.href === "/skills" && user.role === "supervisor"
      ? { ...item, label: "My Tools" }
      : item,
  );

  const items = [
    ...NAV,
    ...(user.role === "agent"
      ? AGENT_NAV
      : [
          ...leaderNav,
          ...(user.role === "supervisor" ? SUPERVISOR_ONLY_NAV : []),
          ...LEADER_NAV,
        ]),
    ...(user.role === "admin" ? ADMIN_NAV : []),
  ];

  return (
    <header className="border-b-2 border-orange-brand bg-navy-800">
      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2.5">
        {/* Purely decorative, sits behind the logo and the identity/actions
            cluster (both given their own stacking order below) and never
            intercepts a click — hidden below 1280px, where there is no room
            for it between the two anyway. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[260px] right-[420px] hidden overflow-hidden xl:block"
        >
          <HeaderScene />
        </div>

        <Link href="/dashboard" className="relative z-10 flex shrink-0 items-center gap-3">
          <BrandMark className="h-9 w-9" id="header" />
          <BrandWordmark tone="light" />
        </Link>

        <div className="relative z-10 flex shrink-0 items-center gap-4">
          {/* Identity leads, actions follow as one cluster — the name used to
              sit between Inbox and Sign out, reading as if it belonged to
              neither. One line each, never wrapped: this block was three
              lines tall before. */}
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold whitespace-nowrap text-cream">{user.name}</p>
            <p className="text-[10px] font-bold tracking-[0.12em] whitespace-nowrap text-orange-brand uppercase">
              {ROLE_LABELS[user.role] ?? user.role}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/notifications"
              aria-label={`Notifications${unread.n > 0 ? `, ${unread.n} unread` : ""}`}
              className="relative border-2 border-navy-500 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand hover:text-orange-brand"
            >
              Inbox
              {unread.n > 0 && (
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center bg-orange-brand px-1 text-[10px] font-bold text-white">
                  {unread.n > 99 ? "99+" : unread.n}
                </span>
              )}
            </Link>

            <SignOutButton />
          </div>
        </div>
      </div>

      <nav
        aria-label="Sections"
        className="border-t-2 border-navy-500 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto flex max-w-7xl overflow-x-auto px-6">
          <NavTabs items={items} />
        </div>
      </nav>
    </header>
  );
}
