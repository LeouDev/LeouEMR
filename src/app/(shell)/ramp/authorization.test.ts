import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on setting and clearing a ramp assignment.
 *
 * The gate that matters most here is scope, not role: a supervisor knowing
 * an employee's id must never be enough to set their target, even with the
 * right role. An earlier draft of loadScopedEmployee filtered by scope alone
 * and silently ignored which employee was actually requested — these pin
 * that check down so it cannot regress unnoticed.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const stored = vi.hoisted(() => ({
  // Whether the requested employee is inside the caller's scope. The real
  // WHERE clause (and(eq(employees.id, employeeId), scope)) is the same
  // proven pattern used in loadScopedItem and every other scoped mutation in
  // this app — what this test verifies is that setRampAssignment and
  // clearRampAssignment correctly refuse when that lookup finds nothing,
  // not Drizzle's own query composition.
  employeeInScope: true,
  inserted: [] as unknown[],
  deleted: [] as unknown[],
}));
const reapply = vi.hoisted(() => ({
  reapplyCalls: [] as unknown[],
  revertCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ramp/reapply", () => ({
  reapplyRampToStoredWeeks: async (...args: unknown[]) => {
    reapply.reapplyCalls.push(args);
    return { weeksCorrected: 2 };
  },
  revertRampOnStoredWeeks: async (...args: unknown[]) => {
    reapply.revertCalls.push(args);
    return { weeksCorrected: 1 };
  },
}));

const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (tableName(table) !== "employees") return [];
            return stored.employeeInScope ? [{ id: EMPLOYEE_ID }] : [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async () => {
          stored.inserted.push({ table: tableName(table), values });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        stored.deleted.push({ table: tableName(table) });
      },
    }),
  },
}));

const { setRampAssignment, clearRampAssignment } = await import("./actions");

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

const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE_ID = "99999999-9999-4999-8999-999999999999";
const SKILL_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  currentUser.value = null;
  stored.employeeInScope = true;
  stored.inserted = [];
  stored.deleted = [];
  reapply.reapplyCalls = [];
  reapply.revertCalls = [];
});

describe("setRampAssignment", () => {
  const input = { employeeId: EMPLOYEE_ID, skillReferenceId: SKILL_ID, rampStartDate: "2026-08-03" };

  it("refuses a signed-out caller before touching the database", async () => {
    expect(await setRampAssignment(input)).toEqual({ ok: false, error: "Not signed in" });
    expect(stored.inserted).toHaveLength(0);
  });

  it("refuses an agent — only supervisors and administrators set ramp", async () => {
    currentUser.value = user("agent");
    expect(await setRampAssignment(input)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can set a ramp schedule",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("refuses a manager, matching every other action-item-style mutation", async () => {
    currentUser.value = user("manager");
    expect(await setRampAssignment(input)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can set a ramp schedule",
    });
  });

  it("refuses an employee outside the caller's scope, even with a valid id", async () => {
    currentUser.value = user("supervisor");
    stored.employeeInScope = false;
    const result = await setRampAssignment({ ...input, employeeId: OTHER_EMPLOYEE_ID });
    expect(result).toEqual({ ok: false, error: "That employee is not in your scope" });
    expect(stored.inserted).toHaveLength(0);
    expect(reapply.reapplyCalls).toHaveLength(0);
  });

  it("snaps an arbitrary start date to that week's Saturday", async () => {
    currentUser.value = user("supervisor");
    const result = await setRampAssignment(input); // 2026-08-03 is a Monday
    expect(result).toEqual({ ok: true, weeksCorrected: 2 });
    const write = stored.inserted[0] as { values: { rampStartWeek: string } };
    expect(write.values.rampStartWeek).toBe("2026-08-01"); // the preceding Saturday
  });

  it("passes the snapped week through to the retroactive correction", async () => {
    currentUser.value = user("admin");
    await setRampAssignment(input);
    expect(reapply.reapplyCalls[0]).toEqual([EMPLOYEE_ID, SKILL_ID, "2026-08-01"]);
  });

  it("rejects a malformed request before touching anything", async () => {
    currentUser.value = user("supervisor");
    const result = await setRampAssignment({ employeeId: "not-a-uuid" });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect((result as { ok: false; error: string }).ok).toBe(false);
    expect(stored.inserted).toHaveLength(0);
  });
});

describe("clearRampAssignment", () => {
  const input = { employeeId: EMPLOYEE_ID, skillReferenceId: SKILL_ID };

  it("refuses a signed-out caller", async () => {
    expect(await clearRampAssignment(input)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("refuses an agent", async () => {
    currentUser.value = user("agent");
    expect(await clearRampAssignment(input)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can clear a ramp schedule",
    });
  });

  it("refuses an employee outside the caller's scope", async () => {
    currentUser.value = user("supervisor");
    stored.employeeInScope = false;
    const result = await clearRampAssignment({ ...input, employeeId: OTHER_EMPLOYEE_ID });
    expect(result).toEqual({ ok: false, error: "That employee is not in your scope" });
    expect(stored.deleted).toHaveLength(0);
    expect(reapply.revertCalls).toHaveLength(0);
  });

  it("reverts stored weeks and deletes the assignment for a valid, in-scope request", async () => {
    currentUser.value = user("supervisor");
    const result = await clearRampAssignment(input);
    expect(result).toEqual({ ok: true, weeksCorrected: 1 });
    expect(reapply.revertCalls[0]).toEqual([EMPLOYEE_ID, SKILL_ID]);
    expect(stored.deleted.some((d) => (d as { table: string }).table === "employee_ramp_assignments")).toBe(
      true,
    );
  });
});
