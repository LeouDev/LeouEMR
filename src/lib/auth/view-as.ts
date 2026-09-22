import type { CurrentUser } from "./session";

/**
 * An administrator looking at the app as one of its managers.
 *
 * The owner is both: the administrator of the app and a manager in the
 * imported data, with a span of team leaders of their own. Their day has
 * both kinds of question — "where is the organisation struggling" and
 * "how is my span doing" — and the manager's pages answer the second in a
 * way the administrator's cannot. So an administrator may switch the whole
 * app to a manager's view, choosing which manager name in the data to
 * stand as, and switch back.
 *
 * It is a narrowing, never a widening: the cookie is honoured only for an
 * account whose real role is administrator, and while it is set every
 * page and action sees a manager — the Users page and the import refuse
 * them like any manager, and the way back is the same toggle. The real
 * role travels beside the viewed one (`actualRole`) so the toggle can be
 * offered to the person who may use it.
 */

export const VIEW_AS_COOKIE = "viewAs";

/** Thirty days, then it quietly lapses back to the real role. */
export const VIEW_AS_MAX_AGE = 30 * 24 * 60 * 60;

export interface ViewAs {
  role: "manager";
  managerName: string;
}

export function encodeViewAs(view: ViewAs): string {
  return `manager:${view.managerName}`;
}

export function parseViewAs(value: string | undefined | null): ViewAs | null {
  if (!value || !value.startsWith("manager:")) return null;
  const managerName = value.slice("manager:".length).trim();
  return managerName ? { role: "manager", managerName } : null;
}

/** The user as the pages should see them: the viewed role for an administrator who switched, otherwise as they are. */
export function applyViewAs(record: CurrentUser, cookie: string | undefined | null): CurrentUser {
  const view = parseViewAs(cookie);
  if (!view || record.role !== "admin") return record;
  return { ...record, role: view.role, managerName: view.managerName, actualRole: "admin" };
}

/** Whether this user may switch views: a real administrator, whichever view they are in now. */
export function canSwitchView(user: Pick<CurrentUser, "role" | "actualRole">): boolean {
  return (user.actualRole ?? user.role) === "admin";
}
