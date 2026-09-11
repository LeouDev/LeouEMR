import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * The approval chain for people who are not in the roster.
 *
 * Only agents are imported, so a supervisor exists in the data purely as a
 * name on their reports' rows. Their approver therefore has to be derived
 * from the team they lead, and these pin down that derivation — including the
 * cases where it must refuse to guess.
 */

const queue = vi.hoisted(() => ({ results: [] as unknown[][] }));
const perfScope = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/lib/queries/performance", () => ({ resolveScopedIds: async () => perfScope.ids }));

// Drizzle builders are thenables that chain, so one self-returning proxy
// stands in for every query shape here. Each awaited query takes the next
// result set, which is what lets a two-query function be driven precisely.
vi.mock("@/lib/db/client", () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(queue.results.shift() ?? []).then(resolve, reject);
        }
        return () => builder;
      },
    },
  );
  return { db: builder };
});

const { canDecideForLeader, decidableLeaderIds, hasCluster, majorityName, managerNameFor, ptoViewIds } =
  await import("./scope");

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

beforeEach(() => {
  queue.results = [];
  perfScope.ids = [];
});

describe("managerNameFor", () => {
  it("reads the manager off the team the person supervises", async () => {
    queue.results = [[{ manager: "Comendador, Leou" }]];
    expect(await managerNameFor(user("supervisor"))).toBe("Comendador, Leou");
  });

  it("refuses to guess when the team spans two managers", async () => {
    // Picking one arbitrarily would hand approval rights to a manager the
    // business never gave them.
    queue.results = [[{ manager: "Comendador, Leou" }, { manager: "Dela Cruz, Maria" }]];
    expect(await managerNameFor(user("supervisor"))).toBeNull();
  });

  it("returns null for someone with no reports", async () => {
    queue.results = [[]];
    expect(await managerNameFor(user("supervisor"))).toBeNull();
  });

  it("returns null for an unlinked account without querying", async () => {
    expect(await managerNameFor(user("supervisor", { employeeEid: null }))).toBeNull();
    expect(queue.results).toHaveLength(0);
  });
});

describe("canDecideForLeader", () => {
  const requester = user("supervisor", { id: "supervisor-9" });

  it("lets the requester's own manager decide", async () => {
    queue.results = [[{ manager: "Comendador, Leou" }]];
    const manager = user("manager", { id: "manager-1", managerName: "Comendador, Leou" });
    expect(await canDecideForLeader(manager, requester)).toBe(true);
  });

  it("refuses a manager from another cluster", async () => {
    queue.results = [[{ manager: "Dela Cruz, Maria" }]];
    const manager = user("manager", { id: "manager-1", managerName: "Comendador, Leou" });
    expect(await canDecideForLeader(manager, requester)).toBe(false);
  });

  it("refuses when the requester's manager cannot be resolved", async () => {
    queue.results = [[]];
    const manager = user("manager", { id: "manager-1", managerName: "Comendador, Leou" });
    expect(await canDecideForLeader(manager, requester)).toBe(false);
  });

  it("never lets anyone decide their own request", async () => {
    const self = user("manager", { id: requester.id, managerName: "Comendador, Leou" });
    expect(await canDecideForLeader(self, requester)).toBe(false);
  });

  it("refuses a peer supervisor outright", async () => {
    expect(await canDecideForLeader(user("supervisor", { id: "supervisor-2" }), requester)).toBe(
      false,
    );
  });

  it("lets an administrator decide", async () => {
    expect(await canDecideForLeader(user("admin", { id: "admin-1" }), requester)).toBe(true);
  });

  it("falls back to the display name when the account has no linked manager name", async () => {
    queue.results = [[{ manager: "Test manager" }]];
    expect(await canDecideForLeader(user("manager", { id: "manager-1" }), requester)).toBe(true);
  });
});

describe("decidableLeaderIds", () => {
  it("is empty for a supervisor — peers do not approve each other", async () => {
    expect(await decidableLeaderIds(user("supervisor"))).toEqual([]);
    expect(queue.results).toHaveLength(0);
  });

  it("is empty for an agent", async () => {
    expect(await decidableLeaderIds(user("agent"))).toEqual([]);
  });

  it("returns the supervisors under a manager", async () => {
    queue.results = [[{ id: "supervisor-1" }, { id: "supervisor-2" }]];
    expect(await decidableLeaderIds(user("manager", { managerName: "Comendador, Leou" }))).toEqual([
      "supervisor-1",
      "supervisor-2",
    ]);
  });
});

describe("cluster view", () => {
  // The cluster query is grouped: one row per manager name with its count.
  it("offers a cluster only to a supervisor whose manager resolves", async () => {
    queue.results = [[{ manager: "Comendador, Leou", n: 4 }]];
    expect(await hasCluster(user("supervisor"))).toBe(true);
  });

  it("keeps the cluster when one report's row still names another manager", async () => {
    // A roster miss or a name written two ways must not take the view away.
    queue.results = [
      [
        { manager: "Comendador, Leou", n: 3 },
        { manager: "Alvaro, Cres", n: 1 },
      ],
    ];
    expect(await hasCluster(user("supervisor"))).toBe(true);
  });

  it("offers none on a genuine even split between two managers", async () => {
    queue.results = [
      [
        { manager: "Comendador, Leou", n: 2 },
        { manager: "Alvaro, Cres", n: 2 },
      ],
    ];
    expect(await hasCluster(user("supervisor"))).toBe(false);
  });

  it("offers none to a manager, whose team already is the cluster", async () => {
    expect(await hasCluster(user("manager"))).toBe(false);
  });

  it("widens a supervisor's calendar to the manager's whole span", async () => {
    queue.results = [[{ manager: "Comendador, Leou", n: 4 }], [{ id: "e1" }, { id: "e2" }]];
    expect(await ptoViewIds(user("supervisor"), "cluster")).toEqual(["e1", "e2"]);
  });

  it("keeps the team view at the supervisor's own reports", async () => {
    perfScope.ids = ["e1"];
    expect(await ptoViewIds(user("supervisor"), "team")).toEqual(["e1"]);
  });

  it("falls back to the team when the manager cannot be resolved", async () => {
    // Fail closed: an unresolvable manager must not widen the calendar.
    queue.results = [[]];
    perfScope.ids = ["e1"];
    expect(await ptoViewIds(user("supervisor"), "cluster")).toEqual(["e1"]);
  });

  it("ignores the cluster view for an agent", async () => {
    perfScope.ids = ["should-not-be-used"];
    queue.results = [[{ id: "self", supervisorEid: "S1" }], [{ id: "teammate" }]];
    expect(await ptoViewIds(user("agent"), "cluster")).toEqual(["teammate"]);
  });
});

describe("majorityName", () => {
  it("returns the only name when every row agrees", () => {
    expect(majorityName(["Comendador, Leou", "Comendador, Leou"])).toBe("Comendador, Leou");
  });

  it("lets one stray row through", () => {
    expect(majorityName(["Comendador, Leou", "Comendador, Leou", "Comendador, Leou", "Alvaro, Cres"])).toBe(
      "Comendador, Leou",
    );
  });

  it("ignores blank rows when counting", () => {
    expect(majorityName(["Comendador, Leou", null, undefined, "Comendador, Leou"])).toBe("Comendador, Leou");
  });

  it("resolves to nobody on an even split", () => {
    expect(majorityName(["Comendador, Leou", "Alvaro, Cres"])).toBeNull();
  });

  it("resolves to nobody with no names at all", () => {
    expect(majorityName([])).toBeNull();
    expect(majorityName([null, null])).toBeNull();
  });
});
