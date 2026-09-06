import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Reporting scope must fail closed exactly as the operational scope does.
 *
 * This widened what a leader can be shown — from "my team now" to "my team as
 * of the period" — so it is worth pinning down that the widening is only in
 * time, never in role. An unlinked account still resolves to nobody, and an
 * agent is never routed through the assignment path at all.
 */

const captured = vi.hoisted(() => ({ where: null as unknown, rows: [] as Array<{ id: string }> }));
const operational = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/lib/queries/performance", () => ({
  resolveScopedIds: async () => operational.ids,
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: async (condition: unknown) => {
            captured.where = condition;
            return captured.rows;
          },
        }),
      }),
    }),
  },
}));

const { reportingScopeIds } = await import("./org-history");

function user(role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user-1",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
    ...overrides,
  };
}

const AS_OF = "2026-08-31";

beforeEach(() => {
  captured.where = null;
  captured.rows = [];
  operational.ids = [];
});

describe("reportingScopeIds", () => {
  it("gives an admin the whole operational scope without consulting assignments", async () => {
    operational.ids = ["a", "b", "c"];
    expect(await reportingScopeIds(user("admin"), AS_OF)).toEqual(["a", "b", "c"]);
    expect(captured.where).toBeNull();
  });

  it("keeps an agent to themselves — history never widens a personal view", async () => {
    operational.ids = ["self"];
    expect(await reportingScopeIds(user("agent"), AS_OF)).toEqual(["self"]);
    expect(captured.where).toBeNull();
  });

  it("resolves a manager through the structure of record", async () => {
    captured.rows = [{ id: "e1" }, { id: "e2" }];
    const result = await reportingScopeIds(
      user("manager", { managerName: "Comendador, Leou" }),
      AS_OF,
    );
    expect(result).toEqual(["e1", "e2"]);
    expect(captured.where).not.toBeNull();
  });

  it("resolves a supervisor through the structure of record", async () => {
    captured.rows = [{ id: "e1" }];
    expect(await reportingScopeIds(user("supervisor"), AS_OF)).toEqual(["e1"]);
  });

  it("gives an unlinked supervisor nobody, not everybody", async () => {
    // The failure that matters: a missing employee id must not become a query
    // with no predicate, which would return the whole company.
    operational.ids = ["should-not-leak"];
    expect(await reportingScopeIds(user("supervisor", { employeeEid: null }), AS_OF)).toEqual([]);
    expect(captured.where).toBeNull();
  });

  it("gives a manager whose name matches nothing an empty scope", async () => {
    captured.rows = [];
    expect(await reportingScopeIds(user("manager", { managerName: "Nobody" }), AS_OF)).toEqual([]);
  });

  it("falls back to the display name when no manager name is linked", async () => {
    captured.rows = [{ id: "e1" }];
    expect(await reportingScopeIds(user("manager"), AS_OF)).toEqual(["e1"]);
  });
});
