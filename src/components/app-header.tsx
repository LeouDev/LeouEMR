import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandMark, BrandWordmark } from "@/components/brand";
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
];

/** Only roles with direct reports; an agent's own details are not a 201 file. */
const LEADER_NAV = [{ href: "/201-file", label: "201 File" }];

/** Admin-only destinations. The pages enforce this themselves too. */
const ADMIN_NAV = [
  { href: "/import", label: "Import" },
  { href: "/users", label: "Users" },
  { href: "/audit", label: "Audit" },
];

/**
 * The application header: identity on top, navigation beneath.
 *
 * The tabs sit on their own row at every width rather than competing with the
 * mark and the account block for one line. With up to ten destinations they
 * could not fit beside the logo, and squeezing them made the row wrap into a
 * ragged two-line block. A single full-width strip scrolls sideways when it
 * has to and stays one clean line the rest of the time.
 */
export async function AppHeader({ user, current }: { user: CurrentUser; current: string }) {
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));

  const items = [
    ...NAV,
    ...(user.role === "agent" ? AGENT_NAV : [...LEADER_ONLY_NAV, ...LEADER_NAV]),
    ...(user.role === "admin" ? ADMIN_NAV : []),
  ];

  return (
    <header className="border-b-2 border-orange-brand bg-navy-800">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2.5">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-3">
          <BrandMark className="h-9 w-9" id="header" />
          <BrandWordmark tone="light" />
        </Link>

        <div className="flex shrink-0 items-center gap-3">
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

          {/* One line each, never wrapped — this block was three lines tall. */}
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold whitespace-nowrap text-cream">{user.name}</p>
            <p className="text-[10px] font-bold tracking-[0.12em] whitespace-nowrap text-orange-brand uppercase">
              {ROLE_LABELS[user.role] ?? user.role}
            </p>
          </div>

          <SignOutButton />
        </div>
      </div>

      <nav
        aria-label="Sections"
        className="border-t-2 border-navy-500 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto flex max-w-7xl overflow-x-auto px-6">
          {items.map((item) => {
            const active = current === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3.5 py-2.5 text-xs font-semibold tracking-[0.06em] whitespace-nowrap uppercase transition ${
                  active
                    ? "border-orange-brand text-cream"
                    : "border-transparent text-navy-100/70 hover:text-cream"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
