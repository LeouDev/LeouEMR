import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on the Records archive.
 *
 * Two gates, both exercised through the real queries with a mocked database:
 * the role gate (an agent never reads the archive, and never reaches the
 * database trying) and the scope gate (a leader's list is narrowed to their
 * own span by the same predicate the action-item list uses, and a leader
 * whose span is empty is shown nothing rather than everything).
 *
 * The db mock is a generic chain, as in org-history.test.ts: every method
 * returns another chainable stub except the two terminal calls that matter —
 * the scope read (`from(employees)`, resolving to the caller's span) and the
 * archive read (the `limit()` at the end of the list query, which captures
 * its WHERE clause and resolves to canned rows).
 */

const mode = vi.hoisted(() => ({ throwOnUse: false }));
const scope = vi.hoisted(() => ({ ids: [] as Array<{ id: string }> }));
const captured = vi.hoisted(() => ({ where: null as unknown, rows: [] as unknown[], listRan: false }));

vi.mock("@/lib/db/client", async () => {
  const schema = await import("@/lib/db/schema");

  const chainable = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (mode.throwOnUse) throw new Error("database reached before the authorization check");
          if (prop === "from") {
            return (table: unknown) =>
              table === schema.employees ? { where: async () => scope.ids } : chainable();
          }
          if (prop === "where") {
            return (condition: unknown) => {
              captured.where = condition;
              return chainable();
            };
          }
          if (prop === "limit") {
            return async () => {
              captured.listRan = true;
              return captured.rows;
            };
          }
          return () => chainable();
        },
      },
    );

  return {
    db: new Proxy(
      {},
      {
        get() {
          if (mode.throwOnUse) throw new Error("database reached before the authorization check");
          return () => chainable();
        },
      },
    ),
  };
});

const { getCoachingRecords, getCoachingRecordDetail } = await import("@/lib/queries/performance");

const MY_TEAM = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

function signedInAs(role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
    ...overrides,
  };
}

const whereParams = () => new PgDialect().sqlToQuery(captured.where as never).params;

beforeEach(() => {
  mode.throwOnUse = false;
  scope.ids = [{ id: MY_TEAM }];
  captured.where = null;
  captured.rows = [];
  captured.listRan = false;
});

describe("the Records archive", () => {
  it("refuses an agent before touching the database", async () => {
    mode.throwOnUse = true;
    expect(await getCoachingRecords(signedInAs("agent"))).toEqual([]);
    expect(await getCoachingRecordDetail(signedInAs("agent"), ITEM)).toBeNull();
  });

  it("narrows a supervisor's list to their own span", async () => {
    await getCoachingRecords(signedInAs("supervisor"));
    expect(captured.listRan).toBe(true);
    expect(whereParams()).toContain(MY_TEAM);
  });

  it("narrows a manager's list to their supervisors' teams the same way", async () => {
    await getCoachingRecords(signedInAs("manager", { managerName: "Comendador, Leou" }));
    expect(captured.listRan).toBe(true);
    expect(whereParams()).toContain(MY_TEAM);
  });

  it("shows a leader with an empty span nothing, not everything", async () => {
    scope.ids = [];
    expect(await getCoachingRecords(signedInAs("supervisor"))).toEqual([]);
    expect(captured.listRan).toBe(false);
    expect(await getCoachingRecordDetail(signedInAs("supervisor"), ITEM)).toBeNull();
  });

  it("gives an unlinked supervisor nobody", async () => {
    expect(await getCoachingRecords(signedInAs("supervisor", { employeeEid: null }))).toEqual([]);
    expect(captured.listRan).toBe(false);
  });

  it("lets an administrator read the whole archive without a span predicate", async () => {
    await getCoachingRecords(signedInAs("admin"));
    expect(captured.listRan).toBe(true);
    expect(whereParams()).not.toContain(MY_TEAM);
  });
});
