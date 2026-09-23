import { describe, expect, it } from "vitest";
import {
  dailySeries,
  daysBetween,
  groupByManager,
  groupByTeam,
  NO_MANAGER,
  NO_TEAM,
  parseDays,
  rangeEnding,
  totals,
  weeklySeries,
  manilaDay,
  type UtilizationAccount,
} from "./report";

function account(overrides: Partial<UtilizationAccount> & { name: string }): UtilizationAccount {
  return {
    userId: `u-${overrides.name}`,
    role: "agent",
    team: "Santos, Maria",
    manager: "Comendador",
    activeDays: [],
    lastSeen: null,
    eodDays: {},
    ...overrides,
  };
}

const accounts: UtilizationAccount[] = [
  account({ name: "Alba", activeDays: ["2026-09-21", "2026-09-22", "2026-09-23"], eodDays: { "2026-09-22": 1, "2026-09-23": 1 }, lastSeen: "2026-09-23T09:00:00Z" }),
  account({ name: "Aniban", activeDays: ["2026-09-23"], eodDays: { "2026-09-23": 1 } }),
  account({ name: "Cruz", activeDays: [] }),
  account({ name: "Santos, Maria", role: "supervisor", activeDays: ["2026-09-22"] }),
  account({ name: "Reyes", team: "Cruz, James", manager: "Dela Cruz", activeDays: ["2026-09-21", "2026-09-23"] }),
  account({ name: "Owner", role: "admin", team: null, manager: null, activeDays: ["2026-09-23"] }),
];

describe("dailySeries", () => {
  it("counts active accounts and EOD reports per day, including empty days", () => {
    const series = dailySeries(accounts, "2026-09-20", "2026-09-23");
    expect(series.map((p) => [p.label, p.activeUsers, p.eodSent])).toEqual([
      ["Sep 20", 0, 0],
      ["Sep 21", 2, 0],
      ["Sep 22", 2, 1],
      ["Sep 23", 4, 2],
    ]);
    expect(daysBetween("2026-09-30", "2026-10-02")).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("groupByTeam", () => {
  it("bands accounts by team leader, most active team first, leadership last", () => {
    const bands = groupByTeam(accounts);
    expect(bands.map((b) => [b.label, b.accounts, b.active, b.activeRate, b.avgActiveDays, b.eodSent])).toEqual([
      ["Cruz, James", 1, 1, 100, 2, 0],
      ["Santos, Maria", 4, 3, 75, 1.3, 3],
      [NO_TEAM, 1, 1, 100, 1, 0],
    ]);
    const santos = bands[1];
    expect(santos.members.map((m) => [m.name, m.activeDays, m.eodSent])).toEqual([
      ["Alba", 3, 2],
      ["Aniban", 1, 1],
      ["Santos, Maria", 1, 0],
      ["Cruz", 0, 0],
    ]);
  });
});

describe("groupByManager", () => {
  it("bands everyone under their manager of record, the unassigned last", () => {
    expect(groupByManager(accounts).map((b) => [b.label, b.accounts, b.active])).toEqual([
      ["Dela Cruz", 1, 1],
      ["Comendador", 4, 3],
      [NO_MANAGER, 1, 1],
    ]);
  });
});

describe("totals, range and parse", () => {
  it("sums the range up", () => {
    const series = dailySeries(accounts, "2026-09-20", "2026-09-23");
    expect(totals(accounts, series)).toEqual({ accounts: 6, active: 5, activeRate: 83, avgDailyActive: 2, eodSent: 3, activeOnLastDay: 4 });
  });

  it("ends the range today and reads the picker", () => {
    expect(rangeEnding("2026-09-23", 7)).toEqual({ start: "2026-09-17", end: "2026-09-23" });
    expect(parseDays("7")).toBe(7);
    expect(parseDays("90")).toBe(90);
    expect(parseDays("45")).toBe(30);
    expect(parseDays(undefined)).toBe(30);
  });
});

describe("weeklySeries and manilaDay", () => {
  it("folds the days into Sunday-to-Saturday weeks with distinct accounts", () => {
    // 20 Sep 2026 is a Sunday: two weeks, the second holding 21-23 Sep... no — 20 Sep starts one week.
    const series = weeklySeries(accounts, "2026-09-16", "2026-09-23");
    expect(series.map((p) => [p.day, p.activeUsers, p.eodSent])).toEqual([
      ["2026-09-13", 0, 0],
      ["2026-09-20", 5, 3],
    ]);
  });

  it("reads the Manila day off an instant", () => {
    // 22 Sep 20:00 UTC is 23 Sep 04:00 in Manila.
    expect(manilaDay(new Date("2026-09-22T20:00:00Z"))).toBe("2026-09-23");
    expect(manilaDay(new Date("2026-09-22T10:00:00Z"))).toBe("2026-09-22");
  });
});
