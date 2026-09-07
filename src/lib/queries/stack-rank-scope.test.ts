import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * What the organization-wide stack rank may show about other people.
 *
 * The ranking is deliberately org-wide — a stack rank that hid your peers
 * could not tell you where you stand. Quality and attendance are not ranking
 * inputs though; they are personnel matters, and showing every employee's
 * audit score and attendance to all 452 people is a far wider disclosure than
 * "where do I stand". These pin down that the ranking stays open while those
 * two columns stay scoped, and that a leader — who has no roster row of their
 * own — still gets a team rather than an empty page.
 */

const scope = vi.hoisted(() => ({ ids: [] as string[] }));
const roster = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; eid: string; name: string; site: string; supervisorName: string }>,
}));
const metrics = vi.hoisted(() => ({
  byEmployee: new Map<string, Record<string, number>>(),
}));

vi.mock("./performance", () => ({ resolveScopedIds: async () => scope.ids }));
vi.mock("./org-history", () => ({
  assignmentAt: () => undefined,
  siteOfRecord: "site",
  supervisorOfRecord: "supervisorName",
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        // Awaitable on its own now that the roster query has no where-clause,
        // while still offering .where() for the callers that do.
        leftJoin: () => {
          const result = Promise.resolve(roster.rows) as Promise<typeof roster.rows> & {
            where: () => Promise<typeof roster.rows>;
          };
          result.where = async () => roster.rows;
          return result;
        },
      }),
    }),
  },
}));
// Nobody in these fixtures has separated, so eligibility is a pass-through.
// The rule itself is covered in eligibility.test.ts.
vi.mock("./eligibility", () => ({ eligibleForPeriod: async (ids: string[]) => ids }));
vi.mock("./period-metrics", () => ({
  getPeriodMetrics: async () =>
    [...metrics.byEmployee.entries()].flatMap(([employeeId, kpis]) =>
      Object.entries(kpis).map(([kpiCode, actualValue]) => ({
        employeeId,
        kpiCode,
        actualValue,
        target: null,
        status: "PASS",
        direction: "higher_is_better",
      })),
    ),
}));

const { getStackRanks } = await import("./stack-rank");

const PERIOD = {
  granularity: "month" as const,
  start: "2026-08-01",
  end: "2026-08-31",
  label: "August 2026",
};

function user(role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user-1",
    email: `${role}@example.test`,
    name: "Reyes, Kristian",
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
    ...overrides,
  };
}

beforeEach(() => {
  roster.rows = [
    { id: "mine", eid: "1", name: "Mine", site: "CEBU", supervisorName: "Reyes, Kristian" },
    { id: "theirs", eid: "2", name: "Theirs", site: "MANILA", supervisorName: "Other, Sup" },
  ];
  metrics.byEmployee = new Map([
    ["mine", { PRODUCTION_RATE: 3.5, MBO: 100, QUALITY: 98.2, ATTENDANCE: 99 }],
    ["theirs", { PRODUCTION_RATE: 4.1, MBO: 100, QUALITY: 91.4, ATTENDANCE: 88 }],
  ]);
  scope.ids = ["mine"];
});

describe("stack rank disclosure", () => {
  it("ranks the whole organization, including people outside the viewer's scope", async () => {
    const ranks = await getStackRanks(user("agent"), null, PERIOD);
    expect(ranks.org.map((r) => r.name)).toEqual(["Theirs", "Mine"]);
    // The ranking basis stays visible, or the page could not do its job.
    expect(ranks.org.map((r) => r.productionRate)).toEqual([4.1, 3.5]);
  });

  it("hides quality and attendance for people outside the viewer's scope", async () => {
    const ranks = await getStackRanks(user("agent"), null, PERIOD);
    const outside = ranks.org.find((r) => r.employeeId === "theirs")!;
    expect(outside.quality).toBeNull();
    expect(outside.attendance).toBeNull();
  });

  it("still shows them for people the viewer already manages", async () => {
    const ranks = await getStackRanks(user("supervisor"), null, PERIOD);
    const inside = ranks.org.find((r) => r.employeeId === "mine")!;
    expect(inside.quality).toBe(98.2);
    expect(inside.attendance).toBe(99);
  });

  it("gives an admin every column, since their scope is everyone", async () => {
    scope.ids = ["mine", "theirs"];
    const ranks = await getStackRanks(user("admin"), null, PERIOD);
    expect(ranks.org.every((r) => r.quality !== null)).toBe(true);
  });

  it("gives a leader a team from their scope, not an empty page", async () => {
    // A supervisor has no roster row, so `self` is null. Before this the page
    // fell through to an "Account not linked" empty state for every leader.
    const ranks = await getStackRanks(user("supervisor"), null, PERIOD);
    expect(ranks.team.map((r) => r.employeeId)).toEqual(["mine"]);
    expect(ranks.teamLabel).toBe("Reyes, Kristian");
  });

  it("labels a manager's team as their span", async () => {
    const ranks = await getStackRanks(user("manager"), null, PERIOD);
    expect(ranks.teamLabel).toBe("Your span");
  });

  it("keeps an agent's team keyed on their own supervisor", async () => {
    const self = { id: "mine", site: "CEBU", supervisorName: "Reyes, Kristian" };
    const ranks = await getStackRanks(user("agent"), self, PERIOD);
    expect(ranks.team.map((r) => r.employeeId)).toEqual(["mine"]);
    expect(ranks.teamLabel).toBe("Reyes, Kristian");
  });
});
