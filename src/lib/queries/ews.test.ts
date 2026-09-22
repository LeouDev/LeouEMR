import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * The EWS roster: everyone in scope, worst risk first, including the people
 * nobody has assessed yet — scored live from the week's figures.
 *
 * The scoring itself (`computeEwsRisk`, `deriveAutoIndicators`,
 * `buildRosterRow`) is exercised in src/lib/ews and is not retested here.
 * What is specific to the query and worth pinning down: an unassessed
 * employee is listed rather than dropped, the latest record supplies the
 * ticks and the one before it the trend, the 201 file supplies a position,
 * narrowing to a team goes through the scope, and scope failing closed is
 * not silently lost. With a month given, the roster is the org history's —
 * who the leader held that month — less anyone separated before it.
 */

const scope = vi.hoisted(() => ({ value: null as unknown }));
const captured = vi.hoisted(() => ({ condition: undefined as unknown, where: {} as Record<string, unknown> }));
const history = vi.hoisted(() => ({ ids: [] as string[], gone: [] as string[] }));
const tables = vi.hoisted(() => ({
  employees: [] as Array<Record<string, unknown>>,
  ews_indicators: [] as Array<Record<string, unknown>>,
  employee_profiles: [] as Array<Record<string, unknown>>,
  ews_headcount: [] as Array<Record<string, unknown>>,
  ranked: [] as Array<Record<string, unknown>>,
}));
const facts = vi.hoisted(() => ({
  range: null as { first: string; last: string } | null,
  byWeek: {} as Record<string, Array<{ employeeId: string; kpiCode: string; actualValue: number }>>,
}));

vi.mock("@/lib/auth/scope", () => ({
  employeeScope: () => scope.value,
  withScope: (_user: unknown, condition: unknown) => {
    captured.condition = condition;
    if (scope.value === null) return null;
    return scope.value === "all" ? condition : { scope: scope.value, condition };
  },
}));

// The month's org history, as the roster reads it: who the leader held
// (`reportingScopeIds`), the supervisor-of-record columns, and who an EWS
// tag separated before the month.
vi.mock("./org-history", () => ({
  reportingScopeIds: async () => history.ids,
  periodOwnerSubquery: () => ({ __sub: "period_owner" }),
  joinPeriodOwner: () => ({ join: "period_owner" }),
  supervisorEidOfRecord: () => ({ name: "supervisor_eid_of_record" }),
  supervisorOfRecord: () => ({ name: "supervisor_of_record" }),
}));
vi.mock("./eligibility", () => ({ separatedBefore: async () => new Set(history.gone) }));

// Real `eq`/`lte`/... build SQL AST nodes; plain data stands in for them so
// the test can read what the query asked for. `sql` stays real: the ranked
// subquery is built with it.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const col = (c: { name?: string } | undefined) => c?.name ?? "?";
  return {
    ...actual,
    eq: (c: { name?: string }, value: unknown) => ({ eq: col(c), value }),
    lte: (c: { name?: string }, value: unknown) => ({ lte: col(c), value }),
    inArray: (c: { name?: string }, values: unknown[]) => ({ inArray: col(c), values }),
    isNotNull: (c: { name?: string }) => ({ isNotNull: col(c) }),
    and: (...parts: unknown[]) => ({ and: parts }),
    asc: (c: { name?: string }) => ({ asc: col(c) }),
    desc: (c: { name?: string }) => ({ desc: col(c) }),
  };
});

vi.mock("./period-metrics", () => ({
  getFactDateRange: async () => facts.range,
  getPeriodMetrics: async (ids: string[], period: { start: string }) =>
    (facts.byWeek[period.start] ?? []).filter((f) => ids.includes(f.employeeId)),
}));

const tableName = (t: unknown) =>
  (t as { __sub?: string })?.__sub ?? ((t as Record<symbol, string>)[Symbol.for("drizzle:Name")] as keyof typeof tables);

vi.mock("@/lib/db/client", () => {
  function chain(rows: unknown[], name: string) {
    const c = {
      where: (condition: unknown) => {
        captured.where[name] = condition;
        return c;
      },
      orderBy: () => c,
      leftJoin: () => c,
      limit: () => c,
      as: (name: string) => ({ __sub: name }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return c;
  }
  const from = (t: unknown) => {
    const name = String(tableName(t));
    return chain(tables[name as keyof typeof tables] ?? [], name);
  };
  return {
    db: {
      select: () => ({ from }),
      selectDistinct: () => ({ from }),
    },
  };
});

const { getEwsHeadcount, getEwsRoster, getEwsTeams } = await import("./ews");

function user(role: UserRole): CurrentUser {
  return {
    id: "user-1",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001772004",
    managerName: null,
  };
}

const person = (id: string, name: string, supervisorEid = "001772004", supervisorName = "Santos, Maria") => ({
  id,
  eid: `9${id}`,
  name,
  supervisorEid,
  supervisorName,
});

const record = (employeeId: string, rank: number, overrides: Record<string, unknown> = {}) => ({
  employeeId,
  week: rank === 1 ? "2026-09-13" : "2026-09-06",
  indicators: {},
  capActive: false,
  attrition: "none",
  attritionDate: null,
  expectedReturn: null,
  actionPlan: null,
  notes: null,
  score: 0,
  updatedAt: new Date("2026-09-19T08:00:00Z"),
  rank,
  assessedByName: "Santos, Maria",
  ...overrides,
});

beforeEach(() => {
  scope.value = "all";
  captured.condition = undefined;
  captured.where = {};
  history.ids = [];
  history.gone = [];
  tables.employees = [];
  tables.ews_indicators = [
    { code: "tardy", label: "Frequent tardiness" },
    { code: "absent", label: "Increased absences" },
    { code: "jobhunt", label: "Job hunting signals" },
  ];
  tables.employee_profiles = [];
  tables.ews_headcount = [];
  tables.ranked = [];
  facts.range = { first: "2026-06-01", last: "2026-09-19" };
  facts.byWeek = {};
});

describe("getEwsRoster", () => {
  it("fails closed: no scope means an empty roster, not everyone", async () => {
    scope.value = null;
    tables.employees = [person("a", "Alpha")];
    const roster = await getEwsRoster(user("supervisor"), null, null);
    expect(roster.rows).toEqual([]);
    expect(roster.totals.size).toBe(0);
  });

  it("lists everyone in scope, scores the unassessed from the data, and orders worst first", async () => {
    tables.employees = [person("a", "Alpha"), person("b", "Beta"), person("c", "Gamma")];
    tables.ranked = [
      record("b", 1, { indicators: { jobhunt: true, tardy: true, absent: true }, capActive: true, score: 4 }),
      record("b", 2, { score: 1 }),
      record("c", 1, { attrition: "black", attritionDate: "2026-09-01" }),
    ];
    facts.byWeek["2026-09-13"] = [
      { employeeId: "a", kpiCode: "ATTENDANCE", actualValue: 80 },
      { employeeId: "a", kpiCode: "PRODUCTION_RATE", actualValue: 3.1 },
      { employeeId: "b", kpiCode: "ATTENDANCE", actualValue: 100 },
    ];

    const roster = await getEwsRoster(user("admin"), null, null);
    expect(roster.dataWeek?.start).toBe("2026-09-13");
    expect(roster.rows.map((r) => r.name)).toEqual(["Gamma", "Alpha", "Beta"]);

    const [gamma, alpha, beta] = roster.rows;
    expect(gamma.riskLevel).toBe("BLACK");
    // Two ticks and the CAP; the stored absence tick is ignored and the data says attendance was full.
    expect(beta.score).toBe(3);
    expect(beta.riskLevel).toBe("YELLOW");
    expect(beta.delta).toBe(2);
    expect(beta.latest?.assessedByName).toBe("Santos, Maria");
    // Never assessed, one absence in the data.
    expect(alpha.latest).toBeNull();
    expect(alpha.score).toBe(1);
    expect(alpha.riskLevel).toBe("YELLOW");
    expect(alpha.delta).toBeNull();
    expect(alpha.auto.absent.caption).toBe("Attendance 80% (flags below 100%)");

    expect(roster.totals).toEqual({ black: 1, red: 0, yellow: 2, green: 0, size: 3 });
    expect(roster.indicators.map((i) => i.code)).toEqual(["tardy", "absent", "jobhunt"]);
  });

  it("takes a position from the 201 file where there is one", async () => {
    tables.employees = [person("a", "Alpha")];
    tables.employee_profiles = [{ eid: "9a", position: "Pharmacy Technician" }];
    const roster = await getEwsRoster(user("admin"), null, null);
    expect(roster.rows[0].position).toBe("Pharmacy Technician");
  });

  it("narrows to a team through the scope, so a manager cannot read past their span", async () => {
    tables.employees = [person("a", "Alpha")];
    await getEwsRoster(user("manager"), "001772004", null);
    expect(captured.condition).toEqual({ eq: "supervisor_eid", value: "001772004" });
    await getEwsRoster(user("manager"), null, null);
    expect(captured.condition).toBeUndefined();
  });

  it("flags nobody from the data before the first import", async () => {
    facts.range = null;
    tables.employees = [person("a", "Alpha")];
    const roster = await getEwsRoster(user("admin"), null, null);
    expect(roster.dataWeek).toBeNull();
    expect(roster.rows[0].score).toBe(0);
    expect(roster.rows[0].auto.lowprod.caption).toBe("No PAR this week");
  });
});

describe("getEwsRoster for a month", () => {
  const september = { granularity: "month" as const, start: "2026-09-01", end: "2026-09-30", label: "September 2026" };

  it("lists who the org history says the leader held that month, by the supervisor of record", async () => {
    history.ids = ["a", "b"];
    tables.employees = [person("a", "Alpha"), person("b", "Beta", "001772004", "Santos, Maria")];
    const roster = await getEwsRoster(user("supervisor"), "001772004", september);
    expect(roster.rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
    expect(captured.where.employees).toEqual({
      and: [{ inArray: "id", values: ["a", "b"] }, { eq: "supervisor_eid_of_record", value: "001772004" }],
    });
  });

  it("keeps everyone with a team when no team is picked, and nobody when the history reaches no one", async () => {
    history.ids = ["a"];
    tables.employees = [person("a", "Alpha")];
    await getEwsRoster(user("admin"), null, september);
    expect(captured.where.employees).toEqual({
      and: [{ inArray: "id", values: ["a"] }, { isNotNull: "supervisor_eid_of_record" }],
    });

    history.ids = [];
    const none = await getEwsRoster(user("admin"), null, september);
    expect(none.rows).toEqual([]);
  });

  it("leaves off anyone separated before the month began", async () => {
    history.ids = ["a", "b"];
    history.gone = ["b"];
    tables.employees = [person("a", "Alpha"), person("b", "Beta")];
    const roster = await getEwsRoster(user("admin"), null, september);
    expect(roster.rows.map((r) => r.name)).toEqual(["Alpha"]);
    expect(roster.totals.size).toBe(1);
  });

  it("does not consult the org history for the attrition read", async () => {
    history.ids = [];
    tables.employees = [person("a", "Alpha")];
    const roster = await getEwsRoster(user("admin"), null, null);
    expect(roster.rows).toHaveLength(1);
  });
});

describe("getEwsTeams", () => {
  it("lists each team leader once, by name, and skips people with none", async () => {
    tables.employees = [
      { supervisorEid: "2", supervisorName: "Reyes, Angela" },
      { supervisorEid: "1", supervisorName: "Cruz, James" },
      { supervisorEid: null, supervisorName: null },
      { supervisorEid: "3", supervisorName: null },
    ];
    expect(await getEwsTeams(user("admin"))).toEqual([
      { supervisorEid: "3", supervisorName: "3" },
      { supervisorEid: "1", supervisorName: "Cruz, James" },
      { supervisorEid: "2", supervisorName: "Reyes, Angela" },
    ]);
    scope.value = null;
    expect(await getEwsTeams(user("agent"))).toEqual([]);
  });
});

describe("getEwsHeadcount", () => {
  beforeEach(() => {
    tables.employees = [
      { supervisorEid: "1", supervisorName: "Cruz, James" },
      { supervisorEid: "2", supervisorName: "Reyes, Angela" },
    ];
    tables.ews_headcount = [
      { supervisorEid: "1", month: 1, openingOverride: 40, newHires: 2, transferIn: 0, transferOut: 0, voluntaryAttrition: 1, involuntaryAttrition: 0 },
      { supervisorEid: "2", month: 1, openingOverride: 10, newHires: 1, transferIn: 0, transferOut: 0, voluntaryAttrition: 0, involuntaryAttrition: 0 },
    ];
  });

  it("adds every team in scope up when no team is picked", async () => {
    const view = await getEwsHeadcount(user("admin"), 2026, null);
    expect(view.teams).toHaveLength(2);
    expect(view.chain[0]).toMatchObject({ opening: 50, newHires: 3, closing: 52 });
    expect(view.stats.projectedEoy).toBe(52);
    expect(view.stats.attritionPct).toBe(2);
  });

  it("shows one team's own chain when picked, and nothing for a team outside scope", async () => {
    const view = await getEwsHeadcount(user("admin"), 2026, "2");
    expect(view.teams.map((t) => t.supervisorEid)).toEqual(["2"]);
    expect(view.chain[0]).toMatchObject({ opening: 10, closing: 11 });

    const outside = await getEwsHeadcount(user("admin"), 2026, "9");
    expect(outside.teams).toEqual([]);
    expect(outside.chain[11].closing).toBe(0);
  });
});
