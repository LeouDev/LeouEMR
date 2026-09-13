import { describe, expect, it } from "vitest";
import type { CurrentUser, UserRole } from "./session";
import {
  canAuditQuality,
  canFileAudit,
  canManageActionItems,
  canRunTeamPrograms,
  canViewRecords,
  countsForRequirement,
  employeeScope,
  isSupportRole,
} from "./scope";

/**
 * The role table, in one place: what each role reads and does. The support
 * roles (trainer, SME) read everyone like an administrator and work like a
 * team leader, except that their audits do not complete the team leader's
 * weekly requirement.
 */

function as(role: UserRole, over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: "Cruz, Ben",
    ...over,
  };
}

describe("employeeScope", () => {
  it("gives the support roles everyone, with or without an employee link", () => {
    expect(employeeScope(as("admin"))).toBe("all");
    expect(employeeScope(as("trainer"))).toBe("all");
    expect(employeeScope(as("sme", { employeeEid: null }))).toBe("all");
    expect(employeeScope(as("supervisor"))).not.toBe("all");
    expect(employeeScope(as("supervisor", { employeeEid: null }))).toBeNull();
  });
});

describe("the role table", () => {
  const roles: UserRole[] = ["admin", "manager", "supervisor", "agent", "trainer", "sme"];
  const table = roles.map((role) => {
    const user = as(role);
    return [
      role,
      isSupportRole(user),
      canViewRecords(user),
      canManageActionItems(user),
      canRunTeamPrograms(user),
      canAuditQuality(user),
      canFileAudit(user),
      countsForRequirement(user),
    ];
  });

  it("reads: support · records · manage items · EWS and ramp · read audits · file audits · counts for requirement", () => {
    expect(table).toEqual([
      ["admin", false, true, true, true, true, false, false],
      ["manager", false, true, false, false, true, false, false],
      ["supervisor", false, true, true, true, true, true, true],
      ["agent", false, false, false, false, false, false, false],
      ["trainer", true, true, true, false, true, true, false],
      ["sme", true, true, true, false, true, true, false],
    ]);
  });
});
