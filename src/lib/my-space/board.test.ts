import { describe, expect, it } from "vitest";
import {
  astronautY,
  boardProgress,
  boxPercent,
  calendarCells,
  canUseMySpace,
  daySummary,
  emptyBoard,
  isBoardEmpty,
  parseBoard,
  planetOffset,
  shiftMonth,
  type Board,
  type BoardItem,
} from "./board";

const item = (id: string, complete = false): BoardItem => ({ id, text: id, note: "", complete });

const board: Board = {
  todos: [item("t1"), item("t2", true)],
  decisions: [item("d1", true), item("d2")],
  ideas: [item("i1")],
  letgo: [item("l1", true)],
};

describe("box progress", () => {
  it("scores the share complete for the boxes that have a checkbox, 0 when empty", () => {
    expect(boxPercent("todos", board.todos)).toBe(50);
    expect(boxPercent("letgo", board.letgo)).toBe(100);
    expect(boxPercent("decisions", [])).toBe(0);
  });

  it("scores ideas by count toward the daily goal, capped at 100", () => {
    expect(boxPercent("ideas", board.ideas)).toBe(20);
    expect(boxPercent("ideas", Array.from({ length: 7 }, (_, i) => item(`i${i}`)))).toBe(100);
  });

  it("averages the four boxes for the overall figure", () => {
    expect(boardProgress(board)).toEqual({ byBox: { todos: 50, decisions: 50, ideas: 20, letgo: 100 }, overall: 55 });
    expect(boardProgress(emptyBoard()).overall).toBe(0);
  });
});

describe("rail geometry", () => {
  it("hides the fill at 0%, shows it all at 100%", () => {
    expect(planetOffset(0)).toBe(68);
    expect(planetOffset(100)).toBe(0);
    expect(planetOffset(50)).toBe(34);
  });

  it("walks the astronaut from the first planet to the last", () => {
    expect(astronautY(0)).toBe(90);
    expect(astronautY(100)).toBe(570);
    expect(astronautY(55)).toBe(354);
  });
});

describe("history", () => {
  it("summarises a saved day", () => {
    expect(daySummary(board)).toBe("1 done · 1 decided · 1 ideas · 1 let go");
  });

  it("reads a snapshot back, and an unreadable one as an empty day", () => {
    expect(parseBoard(board)).toEqual(board);
    expect(parseBoard({ todos: "no" })).toEqual(emptyBoard());
    expect(parseBoard(null)).toEqual(emptyBoard());
    expect(isBoardEmpty(parseBoard(null))).toBe(true);
  });

  it("shifts months across a year end", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("lays out September 2026 Sunday-first with two leading blanks", () => {
    const cells = calendarCells("2026-09-01", new Set(["2026-09-14"]), "2026-09-15", "2026-09-14");
    expect(cells).toHaveLength(2 + 30);
    expect(cells[0]).toMatchObject({ label: "", day: null });
    expect(cells[2]).toMatchObject({ label: "1", day: "2026-09-01", saved: false });
    expect(cells.find((c) => c.day === "2026-09-14")).toMatchObject({ saved: true, selected: true, today: false });
    expect(cells.find((c) => c.day === "2026-09-15")).toMatchObject({ today: true, saved: false });
  });
});

describe("who it is for", () => {
  it("is for every role but the agent", () => {
    expect(canUseMySpace("supervisor")).toBe(true);
    expect(canUseMySpace("manager")).toBe(true);
    expect(canUseMySpace("trainer")).toBe(true);
    expect(canUseMySpace("sme")).toBe(true);
    expect(canUseMySpace("admin")).toBe(true);
    expect(canUseMySpace("agent")).toBe(false);
  });
});
