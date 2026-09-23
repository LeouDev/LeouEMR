import { describe, expect, it } from "vitest";
import { auditWeeksOfMonth, completionByLeader, completionGrid, monthStartOf, shiftMonth } from "./completion";

describe("completionByLeader", () => {
  it("sums each leader's required and completed audits and gives the share", () => {
    const rows = completionByLeader([
      { supervisorName: "Dacanay,Beulah", standing: "active", required: 2, completed: 2 },
      { supervisorName: "Dacanay,Beulah", standing: "active", required: 2, completed: 1 },
      { supervisorName: "Aniban, Brandon", standing: "active", required: 2, completed: 0 },
    ]);
    expect(rows).toEqual([
      { leader: "Aniban, Brandon", activeAgents: 1, required: 2, completed: 0, completionPct: 0 },
      { leader: "Dacanay,Beulah", activeAgents: 2, required: 4, completed: 3, completionPct: 75 },
    ]);
  });

  it("does not count an agent who owed nothing as active, but keeps any audit they got", () => {
    const [row] = completionByLeader([
      { supervisorName: "Lea", standing: "active", required: 2, completed: 2 },
      { supervisorName: "Lea", standing: "on_leave", required: 0, completed: 1 },
    ]);
    expect(row).toMatchObject({ activeAgents: 1, required: 2, completed: 3, completionPct: 150 });
  });

  it("leaves out a leader whose team owed nothing that week", () => {
    expect(
      completionByLeader([{ supervisorName: "Lea", standing: "separated", required: 0, completed: 0 }]),
    ).toEqual([]);
  });

  it("files an agent with no team leader under Unassigned", () => {
    const [row] = completionByLeader([{ supervisorName: null, standing: "active", required: 2, completed: 1 }]);
    expect(row.leader).toBe("Unassigned");
  });
});

describe("auditWeeksOfMonth", () => {
  it("lists the Sunday-to-Saturday weeks that begin in the month", () => {
    // September 2026 begins on a Tuesday; its Sundays are the 6th, 13th, 20th and 27th.
    expect(auditWeeksOfMonth("2026-09-01").map((w) => w.start)).toEqual([
      "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27",
    ]);
  });

  it("has five weeks when the month has five Sundays, and starts on the 1st when that is a Sunday", () => {
    // November 2026 begins on a Sunday and has five of them.
    expect(auditWeeksOfMonth("2026-11-01").map((w) => w.start)).toEqual([
      "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29",
    ]);
  });
});

describe("monthStartOf / shiftMonth", () => {
  it("reads a YYYY-MM parameter and falls back to today's month", () => {
    expect(monthStartOf("2026-08", "2026-09-22")).toBe("2026-08-01");
    expect(monthStartOf("2026-13", "2026-09-22")).toBe("2026-09-01");
    expect(monthStartOf(undefined, "2026-09-22")).toBe("2026-09-01");
  });

  it("steps whole months across a year boundary", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });
});

describe("completionGrid", () => {
  const weeks = auditWeeksOfMonth("2026-09-01");
  const lea = (required: number, completed: number) => ({ supervisorName: "Lea", standing: "active" as const, required, completed });
  const lovely = (required: number, completed: number) => ({ supervisorName: "Lovely", standing: "active" as const, required, completed });

  it("gives every leader one cell per week and a month total", () => {
    const grid = completionGrid(weeks, [
      [lea(2, 2), lovely(2, 1)],
      [lea(2, 1), lovely(2, 2)],
      [lea(2, 0)],
      [lea(2, 2), lovely(2, 2)],
    ]);
    expect(grid.map((g) => g.leader)).toEqual(["Lea", "Lovely"]);
    expect(grid[0].cells.map((c) => c.completionPct)).toEqual([100, 50, 0, 100]);
    expect(grid[0]).toMatchObject({ required: 8, completed: 5, completionPct: 63 });
    // Lovely owed nothing in week 3: an empty cell, not a zero.
    expect(grid[1].cells[2]).toMatchObject({ required: 0, completed: 0, completionPct: null });
    expect(grid[1]).toMatchObject({ required: 6, completed: 5, completionPct: 83 });
  });

  it("is empty when nobody owed anything all month", () => {
    expect(completionGrid(weeks, [[], [], [], []])).toEqual([]);
  });
});
