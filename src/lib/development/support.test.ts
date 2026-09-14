import { describe, expect, it } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";
import { canRewriteRecord } from "./support";

function user(role: UserRole): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
  };
}
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

describe("canRewriteRecord — one owner per RCA and plan", () => {
  it.each(["admin", "supervisor", "manager"] as UserRole[])("leaves %s unrestricted", (role) => {
    expect(canRewriteRecord(user(role), SOMEONE_ELSE)).toBe(true);
  });

  it.each(["trainer", "sme"] as UserRole[])("lets %s write a record where none exists", (role) => {
    expect(canRewriteRecord(user(role), null)).toBe(true);
    expect(canRewriteRecord(user(role), undefined)).toBe(true);
  });

  it.each(["trainer", "sme"] as UserRole[])("lets %s edit what they wrote themselves", (role) => {
    expect(canRewriteRecord(user(role), user(role).id)).toBe(true);
  });

  it.each(["trainer", "sme"] as UserRole[])("keeps someone else's record read-only to %s", (role) => {
    expect(canRewriteRecord(user(role), SOMEONE_ELSE)).toBe(false);
  });
});
