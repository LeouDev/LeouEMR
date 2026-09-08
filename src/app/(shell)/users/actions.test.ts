import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * updateUser is where a pending account's self-reported employeeEid claim
 * either becomes real scope or doesn't — the same claim signup lets anyone
 * type. These pin down the check added here: an EID that matches nobody in
 * the roster must never save, the same way a role claim is never trusted on
 * its own (see the comment beside IMPLIED_ROLE in user-table.tsx). Before
 * this check existed, nothing stopped a typo — or a guess — from linking an
 * account to a person it doesn't belong to.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Real `eq` builds a SQL AST node for a real database to evaluate. Replacing
// it with a row-predicate closure lets the fake `db` below actually filter
// in-memory tables by whichever column the action really queried.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[column.name] === value,
  };
});

const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

let usersRows: Array<Record<string, unknown>> = [];
let employeesRows: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => ({
          limit: () => {
            const rows = tableName(table) === "employees" ? employeesRows : usersRows;
            return Promise.resolve(rows.filter(pred));
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      // `set()` is keyed by the schema's camelCase property names, the same
      // as real Drizzle — mapped here to the snake_case columns the fake
      // rows use, since the mock does none of that translation on its own.
      set: (values: Record<string, unknown>) => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => {
          if (tableName(table) === "users") {
            const mapped = {
              role: values.role,
              status: values.status,
              employee_eid: values.employeeEid,
              manager_name: values.managerName,
            };
            usersRows = usersRows.map((row) => (pred(row) ? { ...row, ...mapped } : row));
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (tableName(table) === "audit_log") auditRows.push(v);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

const { updateUser } = await import("./actions");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REAL_EID = "001895123";

beforeEach(() => {
  currentUser.value = {
    id: ADMIN_ID,
    email: "admin@example.test",
    name: "Test Admin",
    role: "admin",
    status: "active",
    employeeEid: null,
    managerName: null,
  };
  usersRows = [
    { id: ADMIN_ID, name: "Test Admin", employee_eid: null, role: "admin", status: "active", manager_name: null },
    { id: TARGET_ID, name: "Pending Agent", employee_eid: null, role: "agent", status: "pending", manager_name: null },
  ];
  employeesRows = [{ id: "employee-1", eid: REAL_EID }];
  auditRows.length = 0;
});

const input = (over: Partial<Record<string, unknown>> = {}) => ({
  userId: TARGET_ID,
  role: "agent",
  status: "active",
  employeeEid: REAL_EID,
  ...over,
});

describe("linking an account to an employee ID", () => {
  it("refuses an EID that matches nobody on the roster", async () => {
    const result = await updateUser(input({ employeeEid: "999999999" }));
    expect(result).toEqual({
      ok: false,
      error: "No employee found with ID 999999999 — check for a typo, or confirm they're in the imported roster.",
    });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBeNull();
  });

  it("saves once the EID resolves to a real employee", async () => {
    const result = await updateUser(input({ employeeEid: REAL_EID }));
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBe(REAL_EID);
  });

  it("still catches two accounts claiming the same real EID, after confirming it's real", async () => {
    usersRows.push({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Already Linked",
      employee_eid: REAL_EID,
      role: "agent",
      status: "active",
      manager_name: null,
    });
    const result = await updateUser(input({ employeeEid: REAL_EID }));
    expect(result).toEqual({ ok: false, error: `Employee ID ${REAL_EID} is already linked to Already Linked` });
  });

  it("leaves an empty EID alone — nothing to validate against the roster", async () => {
    const result = await updateUser(input({ employeeEid: "" }));
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBeNull();
  });
});

describe("baseline guards", () => {
  it("refuses a non-admin caller", async () => {
    currentUser.value = { ...currentUser.value!, role: "supervisor" };
    const result = await updateUser(input());
    expect(result).toEqual({ ok: false, error: "Only administrators can manage users" });
  });

  it("refuses an admin editing their own account", async () => {
    const result = await updateUser(input({ userId: ADMIN_ID }));
    expect(result).toEqual({ ok: false, error: "You cannot change your own role or status" });
  });
});
