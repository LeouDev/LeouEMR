import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Period } from "./period";

/**
 * Eligibility of the rows in the "By KPI" matrix.
 *
 * The KPI figures themselves are not under test here and must not move — the
 * change was only ever about which employees appear. Every fixture below
 * therefore carries a fixed value per employee, and the last test asserts it
 * arrives unchanged.
 */

const ACTIVE = "11111111-1111-1111-1111-111111111111";
const LEAVER = "22222222-2222-2222-2222-222222222222";

/** Separated 15 September, matching the worked example in the spec. */
const SEPARATED_ON = "2026-09-15";

/** Production hours the leaver logged before separating, per period start. */
const hoursByPeriod = new Map<string, number>();

const month = (start: string, end: string, label: string): Period => ({
  granularity: "month",
  start,
  end,
  label,
});

const AUGUST = month("2026-08-01", "2026-08-31", "August 2026");
const SEPTEMBER = month("2026-09-01", "2026-09-30", "September 2026");
const OCTOBER = month("2026-10-01", "2026-10-31", "October 2026");

// The real rule, unmocked — the point is that this matrix uses the same one.
vi.mock("./eligibility", async () => {
  const actual = await vi.importActual<typeof import("./eligibility")>("./eligibility");
  return {
    ...actual,
    eligibleForPeriod: async (ids: string[], period: Period) =>
      ids.filter((id) =>
        id === LEAVER
          ? actual.eligibilityFor(period, SEPARATED_ON, hoursByPeriod.get(period.start) ?? 0)
          : true,
      ),
  };
});

const metricsFor = (ids: string[]) =>
  ids.map((employeeId) => ({
    employeeId,
    kpiCode: "QUALITY",
    kpiName: "Quality",
    direction: "higher_is_better",
    actualValue: employeeId === LEAVER ? 91.5 : 97.25,
    targetValue: 95,
    status: "PASS",
    sampleSize: 10,
  }));

vi.mock("./period-metrics", () => ({
  getPeriodMetrics: async (ids: string[]) => metricsFor(ids),
}));

/**
 * A chainable stub: every step is awaitable and also offers the next step, so
 * the query builder can be walked to any depth. `where()` resolves to the
 * roster; a `groupBy()` after it belongs to the skill-facts read, which has
 * nothing to return here.
 */
vi.mock("@/lib/db/client", () => {
  const thenable = <T,>(value: T, extra: Record<string, unknown> = {}) =>
    Object.assign(Promise.resolve(value), extra);
  const from = () =>
    thenable(rosterRows, {
      where: () => thenable(rosterRows, { groupBy: () => thenable([]) }),
      groupBy: () => thenable([]),
      innerJoin: () => thenable([], { where: () => thenable([]) }),
      leftJoin: () => thenable([], { where: () => thenable([]) }),
    });
  return { db: { select: () => ({ from }) } };
});

vi.mock("@/lib/import-pipeline/par-scoring", () => ({
  loadSkillReferences: async () => new Map(),
}));

let rosterRows: Array<{ id: string; eid: string; name: string }> = [];

const { getTeamPeriodComparison } = await import("./my-stats");

beforeEach(() => {
  hoursByPeriod.clear();
  rosterRows = [
    { id: ACTIVE, eid: "900000001", name: "Active, Agent" },
    { id: LEAVER, eid: "900000002", name: "Leaver, Agent" },
  ];
});

const idsIn = async (period: Period) => {
  const data = await getTeamPeriodComparison([ACTIVE, LEAVER], period);
  return data.rows.map((r) => r.employeeId);
};

describe("getTeamPeriodComparison eligibility", () => {
  it("includes an active employee regardless of hours", async () => {
    hoursByPeriod.set(SEPTEMBER.start, 0);
    expect(await idsIn(SEPTEMBER)).toContain(ACTIVE);
  });

  it("includes a separated employee who worked more than 30 hours before leaving", async () => {
    hoursByPeriod.set(SEPTEMBER.start, 35);
    expect(await idsIn(SEPTEMBER)).toContain(LEAVER);
  });

  it("excludes a separated employee who worked 30 hours or fewer before leaving", async () => {
    hoursByPeriod.set(SEPTEMBER.start, 20);
    const ids = await idsIn(SEPTEMBER);
    expect(ids).not.toContain(LEAVER);
    // The rest of the team is untouched by one person's exclusion.
    expect(ids).toContain(ACTIVE);
  });

  it("still shows them in August, a month they finished", async () => {
    hoursByPeriod.set(AUGUST.start, 45);
    expect(await idsIn(AUGUST)).toContain(LEAVER);
  });

  it("does not show them in any month after they left", async () => {
    hoursByPeriod.set(OCTOBER.start, 500);
    expect(await idsIn(OCTOBER)).not.toContain(LEAVER);
  });

  it("leaves the KPI figures of an eligible employee exactly as they were", async () => {
    hoursByPeriod.set(AUGUST.start, 45);
    const data = await getTeamPeriodComparison([ACTIVE, LEAVER], AUGUST);

    const leaver = data.rows.find((r) => r.employeeId === LEAVER);
    const active = data.rows.find((r) => r.employeeId === ACTIVE);
    expect(leaver?.cells.QUALITY?.current).toBe(91.5);
    expect(active?.cells.QUALITY?.current).toBe(97.25);
    expect(leaver?.cells.QUALITY?.status).toBe("PASS");
  });
});
