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

// The calendar's team for a month comes from the structure of record; the
// period-owner helpers only need to be embeddable in a query the db mock
// below swallows, so they are stubs here and tested in org-history's own
// suite.
const reporting = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/queries/org-history", () => ({
  reportingScopeIds: async () => reporting.ids,
  periodOwnerSubquery: () => ({}),
  joinPeriodOwner: () => ({}),
  managerOfRecord: () => ({}),
  supervisorEidOfRecord: () => ({}),
}));

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

const {
  calendarViewFor,
  canDecideForLeader,
  decidableLeaderIds,
  hasCluster,
  majorityName,
  managerNameFor,
  ptoViewIds,
} = await import("./scope");

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

const MONTH = { start: "2026-08-01", end: "2026-08-31" };

beforeEach(() => {
  queue.results = [];
  perfScope.ids = [];
  reporting.ids = [];
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

  it("falls back to the cluster linked on the account when the person has no reports", async () => {
    queue.results = [[]];
    expect(await managerNameFor(user("supervisor", { managerName: "Comendador, Leou" }))).toBe(
      "Comendador, Leou",
    );
  });

  it("does not let the link settle a team split across two managers", async () => {
    queue.results = [[{ manager: "Comendador, Leou" }, { manager: "Dela Cruz, Maria" }]];
    expect(await managerNameFor(user("supervisor", { managerName: "Comendador, Leou" }))).toBeNull();
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

  it("lets the manager linked on a requester's account decide while they have no reports", async () => {
    queue.results = [[]];
    const linked = user("supervisor", { id: "supervisor-9", managerName: "Comendador, Leou" });
    const manager = user("manager", { id: "manager-1", managerName: "Comendador, Leou" });
    expect(await canDecideForLeader(manager, linked)).toBe(true);
    expect(await canDecideForLeader(user("manager", { id: "manager-2", managerName: "Alvaro, Cres" }), linked)).toBe(
      false,
    );
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
    // Two reads: the roster's answer, then the accounts linked with no reports.
    queue.results = [[{ id: "supervisor-1" }, { id: "supervisor-2" }], []];
    expect(await decidableLeaderIds(user("manager", { managerName: "Comendador, Leou" }))).toEqual([
      "supervisor-1",
      "supervisor-2",
    ]);
  });

  it("adds a leader linked to the manager on their account who has no reports on the roster", async () => {
    queue.results = [[{ id: "supervisor-1" }], [{ id: "supervisor-9" }, { id: "supervisor-1" }]];
    expect(await decidableLeaderIds(user("manager", { managerName: "Comendador, Leou" }))).toEqual([
      "supervisor-1",
      "supervisor-9",
    ]);
  });
});

describe("cluster view", () => {
  // The cluster query returns one row per report with their manager of
  // record for the month.
  it("offers a cluster only to a supervisor whose manager resolves", async () => {
    reporting.ids = ["e1", "e2"];
    queue.results = [[{ manager: "Comendador, Leou" }, { manager: "Comendador, Leou" }]];
    expect(await hasCluster(user("supervisor"), MONTH)).toBe(true);
  });

  it("keeps the cluster when one report's row names another manager", async () => {
    // A roster miss or a name written two ways must not take the view away.
    reporting.ids = ["e1", "e2", "e3", "e4"];
    queue.results = [
      [
        { manager: "Comendador, Leou" },
        { manager: "Comendador, Leou" },
        { manager: "Comendador, Leou" },
        { manager: "Alvaro, Cres" },
      ],
    ];
    expect(await hasCluster(user("supervisor"), MONTH)).toBe(true);
  });

  it("offers none on a genuine even split between two managers", async () => {
    reporting.ids = ["e1", "e2"];
    queue.results = [[{ manager: "Comendador, Leou" }, { manager: "Alvaro, Cres" }]];
    expect(await hasCluster(user("supervisor"), MONTH)).toBe(false);
  });

  it("falls back to the manager the reports last sat under when there is no team that month", async () => {
    // Between teams, a team leader still belongs to a cluster. The one query
    // made is the latest-manager read of the history.
    reporting.ids = [];
    queue.results = [[{ manager: "Comendador, Leou" }]];
    expect(await hasCluster(user("supervisor"), MONTH)).toBe(true);
  });

  it("offers none to a supervisor whose reports never named a manager", async () => {
    reporting.ids = [];
    queue.results = [[]];
    expect(await hasCluster(user("supervisor"), MONTH)).toBe(false);
  });

  it("takes the cluster linked on the account when there is no team that month", async () => {
    // No history read at all: the link answers before the history would.
    reporting.ids = [];
    queue.results = [];
    expect(await hasCluster(user("supervisor", { managerName: "Comendador, Leou" }), MONTH)).toBe(true);
  });

  it("lets the roster outrank the account's link once the month has a team", async () => {
    // The link stands in only while the roster is silent; with reports on
    // the roster their manager of record is the cluster, whatever the link says.
    reporting.ids = ["e1", "e2"];
    queue.results = [
      [{ manager: "Tuting, Frederic" }, { manager: "Tuting, Frederic" }],
      [{ id: "t1" }],
    ];
    const ids = await ptoViewIds(user("supervisor", { managerName: "Comendador, Leou" }), "cluster", MONTH);
    expect(ids).toEqual(["t1"]);
  });

  it("offers none to a manager, whose team already is the cluster", async () => {
    expect(await hasCluster(user("manager"), MONTH)).toBe(false);
  });

  it("widens a supervisor's calendar to the manager's whole span for the month", async () => {
    reporting.ids = ["e1"];
    queue.results = [[{ manager: "Comendador, Leou" }], [{ id: "e1" }, { id: "e2" }]];
    expect(await ptoViewIds(user("supervisor"), "cluster", MONTH)).toEqual(["e1", "e2"]);
  });

  it("keeps the team view at the supervisor's reports for the month, not today's", async () => {
    reporting.ids = ["june-report"];
    perfScope.ids = ["todays-report"];
    expect(await ptoViewIds(user("supervisor"), "team", MONTH)).toEqual(["june-report"]);
  });

  it("falls back to the team when the manager cannot be resolved", async () => {
    // Fail closed: an unresolvable manager must not widen the calendar.
    reporting.ids = ["e1", "e2"];
    queue.results = [[{ manager: "Comendador, Leou" }, { manager: "Alvaro, Cres" }]];
    expect(await ptoViewIds(user("supervisor"), "cluster", MONTH)).toEqual(["e1", "e2"]);
  });

  it("keeps an agent on their team now, whichever view is asked for", async () => {
    perfScope.ids = ["should-not-be-used"];
    reporting.ids = ["should-not-be-used-either"];
    queue.results = [[{ id: "self", supervisorEid: "S1" }], [{ id: "teammate" }]];
    expect(await ptoViewIds(user("agent"), "cluster", MONTH)).toEqual(["teammate"]);
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

describe("calendarViewFor", () => {
  it("lets a manager pick everyone, agents or team leaders, defaulting to everyone", () => {
    expect(calendarViewFor("manager", undefined)).toBe("everyone");
    expect(calendarViewFor("manager", "agents")).toBe("agents");
    expect(calendarViewFor("manager", "leaders")).toBe("leaders");
    // A supervisor's view names mean nothing to a manager.
    expect(calendarViewFor("manager", "cluster")).toBe("everyone");
  });

  it("lets a supervisor pick their team or their cluster, defaulting to the team", () => {
    expect(calendarViewFor("supervisor", undefined)).toBe("team");
    expect(calendarViewFor("supervisor", "cluster")).toBe("cluster");
    expect(calendarViewFor("supervisor", "leaders")).toBe("team");
  });

  it("keeps an agent and an administrator on the one view they have", () => {
    expect(calendarViewFor("agent", "cluster")).toBe("team");
    expect(calendarViewFor("admin", "leaders")).toBe("team");
  });
});
