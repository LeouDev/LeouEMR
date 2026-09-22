import { describe, expect, it } from "vitest";
import { deriveAutoIndicators, EMPTY_AUTO_METRICS } from "./auto-indicators";
import { buildRosterRow, filterRoster, manualFlags, relativeTime, rosterTotals, sortRoster, type EwsRosterPerson } from "./roster";

const clean = deriveAutoIndicators(EMPTY_AUTO_METRICS);
const flagged = deriveAutoIndicators({ ...EMPTY_AUTO_METRICS, attendance: 80, productionRate: 2.5 });

function person(overrides: Partial<EwsRosterPerson> & { name: string }): EwsRosterPerson {
  return {
    employeeId: `id-${overrides.name}`,
    eid: "900000000",
    position: null,
    supervisorEid: "001772004",
    supervisorName: "Santos, Maria",
    latest: null,
    previousScore: null,
    auto: clean,
    ...overrides,
  };
}

function latest(overrides: Partial<NonNullable<EwsRosterPerson["latest"]>> = {}): NonNullable<EwsRosterPerson["latest"]> {
  return {
    week: "2026-09-13",
    indicators: {},
    capActive: false,
    attrition: "none",
    attritionDate: null,
    expectedReturn: null,
    actionPlan: null,
    notes: null,
    score: 0,
    updatedAt: "2026-09-19T08:00:00Z",
    assessedByName: "Santos, Maria",
    ...overrides,
  };
}

describe("buildRosterRow", () => {
  it("scores the supervisor's ticks plus the data's flags plus the CAP, live", () => {
    const row = buildRosterRow(
      person({
        name: "Okafor, Diane",
        latest: latest({ indicators: { diseng: true, conflict: true, absent: false }, capActive: true, score: 3 }),
        auto: flagged,
      }),
    );
    // Two ticks, two data flags, one CAP.
    expect(row.score).toBe(5);
    expect(row.riskLevel).toBe("RED");
    expect(row.manual).toEqual({ diseng: true, conflict: true });
  });

  it("ignores a stored tick on a derived code: the data answers those now", () => {
    const row = buildRosterRow(person({ name: "Bautista, Carlos", latest: latest({ indicators: { absent: true, lowprod: true }, score: 2 }) }));
    expect(row.score).toBe(0);
    expect(row.riskLevel).toBe("GREEN");
  });

  it("scores someone never assessed from the data alone", () => {
    const row = buildRosterRow(person({ name: "Torres, Miguel", auto: flagged }));
    expect(row.score).toBe(2);
    expect(row.riskLevel).toBe("YELLOW");
    expect(row.delta).toBeNull();
  });

  it("compares the live score with the save before the latest", () => {
    const up = buildRosterRow(person({ name: "A", latest: latest({ indicators: { jobhunt: true } }), previousScore: 0 }));
    expect(up.delta).toBe(1);
    const down = buildRosterRow(person({ name: "B", latest: latest(), previousScore: 4 }));
    expect(down.delta).toBe(-4);
  });

  it("forces the bands for attrition and marks a leave", () => {
    const gone = buildRosterRow(person({ name: "Lim, Patricia", latest: latest({ attrition: "black", attritionDate: "2026-11-01" }) }));
    expect(gone.riskLevel).toBe("BLACK");
    expect(gone.flag).toBeNull();
    const away = buildRosterRow(person({ name: "Dizon, Ronald", latest: latest({ attrition: "loa" }) }));
    expect(away.riskLevel).toBe("RED");
    expect(away.flag).toBe("leave");
  });
});

describe("sortRoster and rosterTotals", () => {
  const rows = [
    buildRosterRow(person({ name: "Zeta", latest: latest({ indicators: { jobhunt: true } }) })),
    buildRosterRow(person({ name: "Alpha" })),
    buildRosterRow(person({ name: "Mid", latest: latest({ attrition: "black" }) })),
    buildRosterRow(person({ name: "Beta", auto: flagged, latest: latest({ indicators: { jobhunt: true, conflict: true } }) })),
  ];

  it("puts the worst first and names in order inside a band", () => {
    expect(sortRoster(rows).map((r) => r.name)).toEqual(["Mid", "Beta", "Zeta", "Alpha"]);
  });

  it("counts each band and the team", () => {
    expect(rosterTotals(rows)).toEqual({ black: 1, red: 1, yellow: 1, green: 1, size: 4 });
  });
});

describe("filterRoster", () => {
  const rows = [
    { name: "Alba, Dorellyn", eid: "900292132", position: "Pharmacy Technician", supervisorName: "Herbias" },
    { name: "Aniban, Brandon", eid: "002233004", position: null, supervisorName: "Dacanay" },
  ];
  it("matches name, employee ID, position or team leader", () => {
    expect(filterRoster(rows, "alba")).toHaveLength(1);
    expect(filterRoster(rows, "002233")).toEqual([rows[1]]);
    expect(filterRoster(rows, "pharmacy")).toEqual([rows[0]]);
    expect(filterRoster(rows, "dacanay")).toEqual([rows[1]]);
    expect(filterRoster(rows, "  ")).toHaveLength(2);
    expect(filterRoster(rows, "nobody")).toHaveLength(0);
  });
});

describe("manualFlags and relativeTime", () => {
  it("keeps only the ticked, non-derived codes", () => {
    expect(manualFlags({ tardy: true, absent: true, jobhunt: false, withdraw: true })).toEqual({ tardy: true, withdraw: true });
    expect(manualFlags(null)).toEqual({});
  });

  it("words the age of a save", () => {
    const now = "2026-09-22T12:00:00Z";
    expect(relativeTime("2026-09-22T11:30:00Z", now)).toBe("just now");
    expect(relativeTime("2026-09-22T08:00:00Z", now)).toBe("4 hours ago");
    expect(relativeTime("2026-09-21T11:00:00Z", now)).toBe("1 day ago");
    expect(relativeTime("2026-09-16T12:00:00Z", now)).toBe("6 days ago");
    expect(relativeTime("2026-07-01T12:00:00Z", now)).toBe("Jul 1, 2026");
    expect(relativeTime("nope", now)).toBe("—");
  });
});
