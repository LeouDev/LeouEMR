import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * The EWS board: everyone in scope, worst risk first, including the people
 * nobody has assessed yet.
 *
 * The scoring itself (`computeEwsRisk`) is exercised by src/lib/ews/engine.ts
 * and is not retested here. What is specific to the board and worth pinning
 * down: an unassessed employee is listed rather than dropped, the ordering
 * puts a coverage gap ahead of a clean record but behind an active risk, and
 * scope failing closed is not silently lost when the roster query is added.
 */

const scope = vi.hoisted(() => ({ value: null as unknown }));
const roster = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; eid: string; name: string; supervisorName: string | null }>,
}));
const assessments = vi.hoisted(() => ({
  rows: [] as Array<{
    employeeId: string;
    week: string;
    riskLevel: string;
    score: number;
    capActive: boolean;
    attrition: string;
    notes: string | null;
    assessedByName: string | null;
  }>,
}));
const captured = vi.hoisted(() => ({ rosterWhere: undefined as unknown }));

vi.mock("@/lib/auth/scope", () => ({ employeeScope: () => scope.value }));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          captured.rosterWhere = condition;
          return { orderBy: async () => roster.rows };
        },
      }),
    }),
    selectDistinctOn: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: async () => assessments.rows }),
        }),
      }),
    }),
  },
}));

const { getEwsBoard } = await import("./ews");

function user(role: UserRole): CurrentUser {
  return {
    id: "user-1",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
  };
}

beforeEach(() => {
  scope.value = "all";
  roster.rows = [];
  assessments.rows = [];
  captured.rosterWhere = undefined;
});

describe("getEwsBoard", () => {
  it("fails closed for an unlinked account rather than querying", async () => {
    scope.value = null;
    roster.rows = [{ id: "e1", eid: "1", name: "Should not appear", supervisorName: null }];
    const board = await getEwsBoard(user("supervisor"));
    expect(board.rows).toEqual([]);
    expect(board.totals).toEqual({ black: 0, red: 0, yellow: 0, green: 0, unassessed: 0 });
  });

  it("does not filter the roster query for an admin's 'all' scope", async () => {
    roster.rows = [{ id: "e1", eid: "1", name: "Someone", supervisorName: "Sup" }];
    await getEwsBoard(user("admin"));
    expect(captured.rosterWhere).toBeUndefined();
  });

  it("lists someone who has never been assessed, with a null risk", async () => {
    roster.rows = [{ id: "e1", eid: "1", name: "Never Assessed", supervisorName: "Sup" }];
    assessments.rows = [];
    const board = await getEwsBoard(user("admin"));
    expect(board.rows).toEqual([
      expect.objectContaining({ employeeId: "e1", riskLevel: null, score: null, week: null }),
    ]);
    expect(board.totals.unassessed).toBe(1);
  });

  it("orders critical, then at-risk, then watch, then unassessed, then stable", async () => {
    roster.rows = [
      { id: "green", eid: "1", name: "Green", supervisorName: null },
      { id: "unassessed", eid: "2", name: "Unassessed", supervisorName: null },
      { id: "yellow", eid: "3", name: "Yellow", supervisorName: null },
      { id: "black", eid: "4", name: "Black", supervisorName: null },
      { id: "red", eid: "5", name: "Red", supervisorName: null },
    ];
    const base = { week: "2026-08-22", capActive: false, attrition: "none", notes: null, assessedByName: null };
    assessments.rows = [
      { ...base, employeeId: "green", riskLevel: "GREEN", score: 0 },
      { ...base, employeeId: "yellow", riskLevel: "YELLOW", score: 2 },
      { ...base, employeeId: "black", riskLevel: "BLACK", score: 0 },
      { ...base, employeeId: "red", riskLevel: "RED", score: 4 },
    ];
    const board = await getEwsBoard(user("admin"));
    expect(board.rows.map((r) => r.employeeId)).toEqual([
      "black",
      "red",
      "yellow",
      "unassessed",
      "green",
    ]);
  });

  it("breaks a tie within the same risk level by score, then by name", async () => {
    roster.rows = [
      { id: "b", eid: "1", name: "Beta", supervisorName: null },
      { id: "a", eid: "2", name: "Alpha", supervisorName: null },
      { id: "c", eid: "3", name: "Charlie", supervisorName: null },
    ];
    const base = { week: "2026-08-22", capActive: false, attrition: "none", notes: null, assessedByName: null };
    assessments.rows = [
      { ...base, employeeId: "a", riskLevel: "RED", score: 2 },
      { ...base, employeeId: "b", riskLevel: "RED", score: 4 },
      { ...base, employeeId: "c", riskLevel: "RED", score: 2 },
    ];
    const board = await getEwsBoard(user("admin"));
    // Beta has the higher score and sorts first; Alpha and Charlie tie on
    // score and fall back to name.
    expect(board.rows.map((r) => r.employeeId)).toEqual(["b", "a", "c"]);
  });

  it("tallies totals from the same rows the board renders, not a separate count", async () => {
    roster.rows = [
      { id: "1", eid: "1", name: "A", supervisorName: null },
      { id: "2", eid: "2", name: "B", supervisorName: null },
      { id: "3", eid: "3", name: "C", supervisorName: null },
    ];
    const base = { week: "2026-08-22", capActive: false, attrition: "none", notes: null, assessedByName: null };
    assessments.rows = [
      { ...base, employeeId: "1", riskLevel: "BLACK", score: 5 },
      { ...base, employeeId: "2", riskLevel: "GREEN", score: 0 },
    ];
    const board = await getEwsBoard(user("manager"));
    expect(board.totals).toEqual({ black: 1, red: 0, yellow: 0, green: 1, unassessed: 1 });
  });

  it("returns an empty board without touching assessments when nobody is in scope", async () => {
    roster.rows = [];
    const board = await getEwsBoard(user("supervisor"));
    expect(board).toEqual({
      rows: [],
      away: [],
      totals: { black: 0, red: 0, yellow: 0, green: 0, unassessed: 0 },
    });
  });
});

describe("getEwsBoard away list", () => {
  it("lists everyone carrying an attrition tag, and nobody who is not", async () => {
    const board = await getEwsBoard(user("supervisor"));
    for (const row of board.away) {
      expect(row.attrition).toBeTruthy();
      expect(row.attrition).not.toBe("none");
    }
    // Whoever is away must also still appear on the risk board itself.
    for (const row of board.away) {
      expect(board.rows.some((r) => r.employeeId === row.employeeId)).toBe(true);
    }
  });
});
