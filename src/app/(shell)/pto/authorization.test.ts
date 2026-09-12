import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on leave decisions.
 *
 * Role alone is not the check that matters here: one supervisor must not be
 * able to decide another team's leave by posting a request id they happen to
 * know. These drive the real action with a mocked session and scope so both
 * gates are exercised.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const scope = vi.hoisted(() => ({ ids: [] as string[] }));
const stored = vi.hoisted(() => ({
  request: null as null | Record<string, unknown>,
  requester: null as null | Record<string, unknown>,
  updates: [] as unknown[],
}));
const leaderRule = vi.hoisted(() => ({ allows: false }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("@/lib/queries/performance", () => ({ resolveScopedIds: async () => scope.ids }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pto/scope", () => ({ canDecideForLeader: async () => leaderRule.allows }));

// The action reads two different tables, so the mock has to tell them apart.
// Drizzle stamps every table with its name under this symbol.
const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            const row = tableName(table) === "users" ? stored.requester : stored.request;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          stored.updates.push(values);
        },
      }),
    }),
    insert: () => ({ values: async () => {} }),
  },
}));

const { cancelPto, decidePto } = await import("./actions");

const OTHER_TEAM = "11111111-1111-4111-8111-111111111111";
const MY_TEAM = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const SUPERVISOR_ID = "44444444-4444-4444-8444-444444444444";
const MANAGER_ID = "55555555-5555-4555-8555-555555555555";
const REQUESTING_LEADER_ID = "66666666-6666-4666-8666-666666666666";

function signedInAs(role: UserRole, id = SUPERVISOR_ID): CurrentUser {
  return {
    id,
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
  };
}

function pendingRequestFor(employeeId: string, requestedBy = "someone-else") {
  return {
    id: REQUEST_ID,
    employeeId,
    requestedBy,
    status: "pending",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
  };
}

beforeEach(() => {
  currentUser.value = signedInAs("supervisor");
  scope.ids = [MY_TEAM];
  stored.request = pendingRequestFor(MY_TEAM);
  stored.requester = { id: REQUESTING_LEADER_ID, role: "supervisor", name: "Test supervisor" };
  stored.updates = [];
  leaderRule.allows = false;
});

const decide = () => decidePto({ requestId: REQUEST_ID, decision: "approved" });

describe("deciding leave", () => {
  it("lets a supervisor decide for their own team", async () => {
    expect(await decide()).toEqual({ ok: true });
    expect(stored.updates).toHaveLength(1);
  });

  it("refuses a request from outside the caller's span", async () => {
    // The role is right; the subject is not theirs. This is the check that
    // a role-only guard would miss.
    stored.request = pendingRequestFor(OTHER_TEAM);
    expect(await decide()).toEqual({ ok: false, error: "That employee is not in your team" });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses an agent outright", async () => {
    currentUser.value = signedInAs("agent");
    expect(await decide()).toEqual({
      ok: false,
      error: "Only a supervisor, manager or administrator can decide leave",
    });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    currentUser.value = null;
    expect(await decide()).toEqual({ ok: false, error: "Not signed in" });
  });

  it("refuses a pending account, whatever its role", async () => {
    currentUser.value = { ...signedInAs("manager"), status: "pending" };
    expect(await decide()).toEqual({ ok: false, error: "Not signed in" });
  });

  it("stops anyone approving their own leave", async () => {
    stored.request = pendingRequestFor(MY_TEAM, SUPERVISOR_ID);
    expect(await decide()).toEqual({ ok: false, error: "You cannot decide your own leave request" });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses to decide a request twice", async () => {
    stored.request = { ...pendingRequestFor(MY_TEAM), status: "approved" };
    expect(await decide()).toEqual({ ok: false, error: "This request was already approved" });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses an unknown request", async () => {
    stored.request = null;
    expect(await decide()).toEqual({ ok: false, error: "Request not found" });
  });

  it("rejects a malformed decision before touching anything", async () => {
    expect(await decidePto({ requestId: REQUEST_ID, decision: "maybe" })).toEqual({
      ok: false,
      error: "Invalid decision",
    });
    expect(stored.updates).toHaveLength(0);
  });

  it("records who decided and when", async () => {
    await decide();
    const update = stored.updates[0] as Record<string, unknown>;
    expect(update.status).toBe("approved");
    expect(update.decidedBy).toBe(SUPERVISOR_ID);
    expect(update.decidedAt).toBeInstanceOf(Date);
  });
});

/**
 * A supervisor has no employee row, so their own request carries a null
 * employeeId and cannot be checked against anyone's employee scope. It is
 * routed through the manager relationship instead — and that branch must be
 * just as closed as the employee one.
 */
describe("deciding a leader's own leave", () => {
  const leaderRequest = () => ({
    id: REQUEST_ID,
    employeeId: null,
    requestedBy: REQUESTING_LEADER_ID,
    status: "pending",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
  });

  beforeEach(() => {
    currentUser.value = { ...signedInAs("manager", MANAGER_ID), managerName: "Comendador, Leou" };
    stored.request = leaderRequest();
  });

  it("lets the requester's own manager approve", async () => {
    leaderRule.allows = true;
    expect(await decide()).toEqual({ ok: true });
    expect(stored.updates).toHaveLength(1);
  });

  it("refuses a manager from outside the requester's cluster", async () => {
    // The employee scope cannot help here — there is no employee. Without the
    // manager check this would fall straight through to the update.
    leaderRule.allows = false;
    expect(await decide()).toEqual({
      ok: false,
      error: "Only their manager can approve that request",
    });
    expect(stored.updates).toHaveLength(0);
  });

  it("never lets a leader approve their own request", async () => {
    leaderRule.allows = true;
    currentUser.value = signedInAs("manager", REQUESTING_LEADER_ID);
    expect(await decide()).toEqual({ ok: false, error: "You cannot decide your own leave request" });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses when the requesting account no longer exists", async () => {
    leaderRule.allows = true;
    stored.requester = null;
    expect(await decide()).toEqual({ ok: false, error: "Request has no requester" });
    expect(stored.updates).toHaveLength(0);
  });

  it("still refuses an agent, whoever the request belongs to", async () => {
    leaderRule.allows = true;
    currentUser.value = signedInAs("agent");
    expect(await decide()).toEqual({
      ok: false,
      error: "Only a supervisor, manager or administrator can decide leave",
    });
    expect(stored.updates).toHaveLength(0);
  });
});

/**
 * Cancelling reaches exactly as far as deciding: the requester withdraws
 * their own, and a leader cancels only for the people they could approve.
 */
describe("cancelling leave", () => {
  it("lets a supervisor cancel a direct report's approved leave", async () => {
    stored.request = { ...pendingRequestFor(MY_TEAM), status: "approved" };
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: true });
    expect(stored.updates).toHaveLength(1);
    expect(stored.updates[0]).toMatchObject({ status: "cancelled" });
  });

  it("refuses a request from outside the caller's span", async () => {
    stored.request = pendingRequestFor(OTHER_TEAM);
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: false, error: "That employee is not in your team" });
    expect(stored.updates).toHaveLength(0);
  });

  it("lets a manager cancel a supervisor's own leave in their cluster", async () => {
    currentUser.value = signedInAs("manager", MANAGER_ID);
    stored.request = { ...pendingRequestFor(MY_TEAM, REQUESTING_LEADER_ID), employeeId: null };
    leaderRule.allows = true;
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: true });
    expect(stored.updates).toHaveLength(1);
  });

  it("refuses a manager from outside the supervisor's cluster", async () => {
    currentUser.value = signedInAs("manager", MANAGER_ID);
    stored.request = { ...pendingRequestFor(MY_TEAM, REQUESTING_LEADER_ID), employeeId: null };
    leaderRule.allows = false;
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: false, error: "Only their manager can cancel that request" });
    expect(stored.updates).toHaveLength(0);
  });

  it("still lets anyone withdraw their own request", async () => {
    currentUser.value = signedInAs("agent");
    stored.request = pendingRequestFor(MY_TEAM, currentUser.value.id);
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: true });
  });

  it("never lets an agent cancel someone else's", async () => {
    currentUser.value = signedInAs("agent");
    stored.request = pendingRequestFor(MY_TEAM);
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: false, error: "You can only withdraw your own request" });
    expect(stored.updates).toHaveLength(0);
  });

  it("refuses to cancel what is already decided against or withdrawn", async () => {
    stored.request = { ...pendingRequestFor(MY_TEAM), status: "denied" };
    expect(await cancelPto(REQUEST_ID)).toEqual({ ok: false, error: "This request was already denied" });
  });
});
