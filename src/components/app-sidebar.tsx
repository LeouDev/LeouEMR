import { and, count, eq, isNull } from "drizzle-orm";
import { ProfilePanel } from "@/components/profile-panel";
import { SidebarShell } from "@/components/sidebar-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { isSupportRole } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employeeProfiles, employees, notifications, userAvatars } from "@/lib/db/schema";
import { formFromProfile } from "@/lib/profile/panel";

/** Kept short: a wrapping role label was the widest thing in the old header. */
const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Team Leader",
  agent: "Agent",
  trainer: "Trainer",
  sme: "SME",
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
 * The archive of what has been written against action items — RCA, time and
 * motion, action plan, acknowledgement — read-only and printable. Sits right
 * after Action Items, whose written record it is. A leader's view: an agent
 * reads their own items on the action-item pages (canViewRecords).
 */
const RECORDS_NAV = { href: "/records", label: "Records" };

/**
 * A leader's own daily board — to dos, decisions, ideas, what to let go
 * of — beside the work it is about. Every role but the agent, whose day is
 * on their action items; the page refuses an agent by URL as well.
 */
const MY_SPACE_NAV = { href: "/my-space", label: "My Space" };

/**
 * An agent works from their own numbers, not the shared configuration: the
 * skill reference is a scoring policy table they cannot change, so their
 * slot goes to their own stats instead.
 */
const AGENT_NAV = [
  { href: "/my-stats", label: "My Tools" },
  { href: "/my-quality-scores", label: "My Quality Scores" },
  { href: "/scorecard", label: "My Scorecard" },
];

/**
 * Leaders only. An agent's own MBO is on My Stats; the MBO page is a roster
 * of who is passing across a team, which is not theirs to read.
 */
const LEADER_ONLY_NAV = [
  { href: "/mbo", label: "MBO" },
  // The monthly scorecard: a team leader reviews their people's, a manager
  // or admin reads their span's. Not for a support role (filtered below).
  { href: "/scorecard", label: "Scorecard" },
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
const LEADER_NAV = [
  { href: "/quality", label: "Quality Audit" },
  { href: "/201-file", label: "201 File" },
];

/**
 * An administrator's day-to-day question is "where is the org struggling,"
 * which this answers directly — placed right beside Dashboard rather than
 * at the tail end with the rest of admin-only nav, since it is read at
 * least as often as the dashboard itself.
 */
const ANALYTICS_NAV = { href: "/analytics", label: "Analytics" };

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
 * The application's chrome: a left rail with the brand, every destination
 * stacked, and the person at the foot — in place of the old single-row
 * header, whose dozen tabs had outgrown one line. Rendered once by the
 * (shell) layout, so navigating never recreates it; which link is active
 * comes from the links reading the pathname themselves.
 */
export async function AppSidebar({ user, initialOpen }: { user: CurrentUser; initialOpen: boolean }) {
  // One round trip for everything the rail carries: the unread count, the
  // person's own personnel record (the profile panel is seeded from it
  // here rather than fetched when opened) and, for a linked account, the
  // roster's team leader and manager.
  const [[unread], [profileRow], [orgRow], [avatarRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt))),
    db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, user.id)).limit(1),
    user.employeeEid
      ? db
          .select({ supervisorName: employees.supervisorName, managerName: employees.managerName })
          .from(employees)
          .where(eq(employees.eid, user.employeeEid))
          .limit(1)
      : Promise.resolve([] as Array<{ supervisorName: string | null; managerName: string | null }>),
    // Only the timestamp: it versions the picture's URL, and the route
    // serves the bytes once, cached for good.
    db.select({ updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, user.id)).limit(1),
  ]);
  const profile = profileRow
    ? { ...formFromProfile(profileRow), employeeEid: profileRow.employeeEid, position: profileRow.position }
    : null;
  // Shortcuts to the person's own pages: an agent's tools and scores, a
  // team leader's calculators. Nothing for the other roles, whose own
  // pages are all in the nav already.
  const quickLinks =
    user.role === "agent" ? AGENT_NAV : user.role === "supervisor" ? [{ href: "/skills", label: "My Tools" }] : [];

  // A supervisor's /skills tab has no configuration to reference — just the
  // rating and quality calculators — so it reads as "My Tools" for them
  // specifically, while a manager or admin still sees "Skills".
  const support = isSupportRole(user);
  const leaderNav = LEADER_ONLY_NAV.map((item) =>
    item.href === "/skills" && user.role === "supervisor" ? { ...item, label: "My Tools" } : item,
  );

  const items = [
    // Dashboard first, then Analytics immediately beside it for an admin —
    // ahead of the rest of NAV, not appended with the rest of admin-only
    // nav at the tail end.
    NAV[0],
    ...(user.role === "admin" ? [ANALYTICS_NAV] : []),
    // An agent's Employees roster is a list of one — themselves — so the tab
    // only ever led back to their own page, which their dashboard and action
    // items already link to directly. The page itself stays reachable.
    //
    // An admin's own Employees tab is replaced by Analytics above: an
    // administrator's day-to-day question is "where is the org struggling,"
    // which is what that tab answers directly, while the roster search and
    // per-employee lookup Employees offers stays reachable by URL and from
    // every link that already points at a specific employee.
    ...NAV.slice(1)
      .filter((item) => item.href !== "/employees" || (user.role !== "agent" && user.role !== "admin"))
      // No leave calendar for a support role: nobody reports to them, and
      // their own leave is not filed here.
      .filter((item) => item.href !== "/pto" || !support)
      .flatMap((item) =>
        item.href === "/action-items" && user.role !== "agent" ? [item, RECORDS_NAV, MY_SPACE_NAV] : [item],
      ),
    ...(user.role === "agent"
      ? AGENT_NAV
      : [
          // A support role (trainer, SME) has no team-leader tooling: no
          // calculators, EWS or Ramp, and no Adherence — MBO, the audits
          // and the 201 file are what they work with.
          ...(support ? leaderNav.filter((item) => item.href === "/mbo") : leaderNav),
          ...(user.role === "supervisor" ? SUPERVISOR_ONLY_NAV : []),
          ...LEADER_NAV,
        ]),
    ...(user.role === "admin" ? ADMIN_NAV : []),
  ];

  return (
    <SidebarShell
      items={items}
      unread={unread.n}
      initialOpen={initialOpen}
      profile={
        <ProfilePanel
          account={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] ?? user.role, employeeEid: user.employeeEid }}
          profile={profile}
          org={orgRow ?? null}
          quickLinks={quickLinks}
          avatarVersion={avatarRow ? avatarRow.updatedAt.getTime() : null}
        />
      }
      signOut={<SignOutButton tone="sidebar" />}
    />
  );
}
