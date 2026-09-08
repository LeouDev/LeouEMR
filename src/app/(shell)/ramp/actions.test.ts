import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * clearRampAssignment must remove only the (employee, skill) pair it was
 * asked to clear.
 *
 * An employee can ramp on more than one skill at once — the unique index is
 * (employee_id, skill_reference_id), not employee_id alone — so a delete
 * scoped by employee only silently wipes every OTHER skill's ramp the
 * moment a supervisor clears one of them. The mock below models real
 * row-level deletion (rather than always returning a canned single row)
 * specifically so this test can catch that class of bug: the where-clause
 * columns matter, not just whether a delete happened.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ramp/reapply", () => ({
  reapplyRampToStoredWeeks: async () => ({ weeksCorrected: 0 }),
  revertRampOnStoredWeeks: async () => ({ weeksCorrected: 0 }),
}));

// Real `and`/`eq` build SQL AST objects meant for a real database to
// evaluate. Replacing them with row-predicate functions lets the fake `db`
// below actually filter an in-memory table by whichever columns the action
// really passed — proving the delete's WHERE clause, not just its intent.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) =>
      row[column.name] === value,
    and: (...preds: Array<(row: Record<string, unknown>) => boolean>) => (row: Record<string, unknown>) =>
      preds.every((p) => p(row)),
  };
});

const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

let rampRows: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => {
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              // The only select in this action's path is loadScopedEmployee's
              // employees lookup; the employee always exists and is in scope.
              void table;
              return Promise.resolve([{ id: "employee-1" }]);
            },
          }),
        }),
      }),
      delete: (table: unknown) => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => {
          if (tableName(table) === "employee_ramp_assignments") {
            rampRows = rampRows.filter((row) => !pred(row));
          }
          return Promise.resolve(undefined);
        },
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (tableName(table) === "audit_log") auditRows.push(v);
          return Promise.resolve(undefined);
        },
      }),
    },
  };
});

const { clearRampAssignment } = await import("./actions");

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const FAX_SKILL = "22222222-2222-4222-8222-222222222222";
const GLP1_SKILL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  currentUser.value = {
    id: "admin-1",
    email: "admin@example.test",
    name: "Test Admin",
    role: "admin",
    status: "active",
    employeeEid: null,
    managerName: null,
  };
  rampRows = [
    { employee_id: EMPLOYEE, skill_reference_id: FAX_SKILL },
    { employee_id: EMPLOYEE, skill_reference_id: GLP1_SKILL },
  ];
  auditRows.length = 0;
});

describe("clearRampAssignment", () => {
  it("removes only the ramp assignment for the requested skill", async () => {
    const result = await clearRampAssignment({ employeeId: EMPLOYEE, skillReferenceId: FAX_SKILL });
    expect(result.ok).toBe(true);
    expect(rampRows).toEqual([{ employee_id: EMPLOYEE, skill_reference_id: GLP1_SKILL }]);
  });

  it("leaves other skills' ramp assignments untouched for the same employee", async () => {
    await clearRampAssignment({ employeeId: EMPLOYEE, skillReferenceId: GLP1_SKILL });
    expect(rampRows).toEqual([{ employee_id: EMPLOYEE, skill_reference_id: FAX_SKILL }]);
  });

  it("does nothing when the (employee, skill) pair has no assignment", async () => {
    await clearRampAssignment({ employeeId: EMPLOYEE, skillReferenceId: "44444444-4444-4444-8444-444444444444" });
    expect(rampRows).toHaveLength(2);
  });
});
