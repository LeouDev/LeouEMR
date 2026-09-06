import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Supervisor / Team Leader",
  agent: "Agent",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/action-items", label: "Action Items" },
  { href: "/skills", label: "Skill Reference" },
];

/** Only roles with direct reports; an agent's own details are not a 201 file. */
const LEADER_NAV = [{ href: "/201-file", label: "201 File" }];

/** Admin-only destinations. The pages enforce this themselves too. */
const ADMIN_NAV = [
  { href: "/import", label: "Import" },
  { href: "/users", label: "Users" },
  { href: "/audit", label: "Audit" },
];

export async function AppHeader({ user, current }: { user: CurrentUser; current: string }) {
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));

  return (
    <header className="border-b border-line bg-surface">
      <div className="h-1 bg-gradient-to-r from-navy-800 via-navy to-orange-brand" />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-3">
            <BrandMark className="h-9 w-9" />
            <span>
              <BrandWordmark className="block text-lg leading-tight" />
              <span className="text-[10px] tracking-[0.14em] text-muted uppercase">
                People <span className="text-orange-brand">|</span> Process{" "}
                <span className="text-orange-brand">|</span> Progress
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {[
              ...NAV,
              ...(user.role === "agent" ? [] : LEADER_NAV),
              ...(user.role === "admin" ? ADMIN_NAV : []),
            ].map((item) => {
              const active = current === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-navy-100 text-navy-900"
                      : "text-muted hover:bg-cream hover:text-navy-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/notifications"
            aria-label={`Notifications${unread.n > 0 ? `, ${unread.n} unread` : ""}`}
            className="relative rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy-800 transition hover:border-orange-brand hover:text-orange-brand"
          >
            Inbox
            {unread.n > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-brand px-1 text-[10px] font-bold text-white">
                {unread.n > 99 ? "99+" : unread.n}
              </span>
            )}
          </Link>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-navy-900">{user.name}</p>
            <p className="text-xs text-muted">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
