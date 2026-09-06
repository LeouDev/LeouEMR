import { and, eq, or, type SQL } from "drizzle-orm";
import { employees } from "@/lib/db/schema";
import type { CurrentUser } from "./session";

/**
 * Builds the employee-visibility filter for a user.
 *
 * This is the single place role scoping is expressed, so every query that
 * reads employee data goes through the same rule rather than each screen
 * inventing its own. Returning `null` means "no rows" — never "all rows" —
 * so a misconfigured account fails closed.
 *
 * The source data identifies supervisors by EID and managers by name only
 * (there is no manager EID anywhere in the workbook), so those are the
 * fields scoping keys on.
 */
export function employeeScope(user: CurrentUser): SQL | null | "all" {
  switch (user.role) {
    case "admin":
      return "all";

    case "manager": {
      // The workbook identifies managers by name only, so the span is keyed
      // on the name an administrator linked to this account. Falling back to
      // the display name keeps accounts working where the two already agree,
      // but an unlinked account whose name matches nothing sees nobody —
      // which is the fail-closed outcome, not a silent "all rows".
      const name = user.managerName ?? user.name;
      return eq(employees.managerName, name);
    }

    case "supervisor":
      if (!user.employeeEid) return null;
      return eq(employees.supervisorEid, user.employeeEid);

    case "agent":
      if (!user.employeeEid) return null;
      return eq(employees.eid, user.employeeEid);

    default:
      return null;
  }
}

/** Combines the scope with an additional condition, preserving fail-closed behavior. */
export function withScope(user: CurrentUser, condition?: SQL): SQL | null | undefined {
  const scope = employeeScope(user);
  if (scope === null) return null;
  if (scope === "all") return condition;
  return condition ? and(scope, condition) : scope;
}

/** True when the user may act on (not just view) an employee's action items. */
export function canManageActionItems(user: CurrentUser): boolean {
  return user.role === "admin" || user.role === "supervisor";
}

/** Agents acknowledge their own items; nobody acknowledges on their behalf. */
export function canAcknowledge(user: CurrentUser): boolean {
  return user.role === "agent";
}

export { or };
