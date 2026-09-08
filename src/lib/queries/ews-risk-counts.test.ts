import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Period } from "./period";

/**
 * getEwsRiskCounts is a historical read — everyone's latest assessment as
 * of a period's end — unlike getEwsBoard's always-latest "right now" board.
 * The one thing worth pinning down here that getEwsBoard's own tests never
 * exercise: an assessment recorded AFTER the cutoff must not count, even
 * though it would already be showing on today's live board.
 */

const roster = vi.hoisted(() => ({ rows: [] as Array<{ id: string }> }));
// Keyed by the real DB column names (employee_id, not employeeId) — the
// mocked eq/inArray/lte below read a real column's own `.name`, which is
// the snake_case DB name, not the camelCase Drizzle property.
const assessments = vi.hoisted(() => ({
  rows: [] as Array<{ employee_id: string; week: string; riskLevel: string }>,
}));

// Real `lte`/`inArray`/`and` build SQL AST nodes for a real database to
// evaluate. Replacing them with row-predicate closures lets the fake db
// below actually filter assessments.rows by the cutoff the function really
// passed, rather than trusting a canned return value.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    lte: (column: { name: string }, value: string) => (row: Record<string, unknown>) =>
      (row[column.name] as string) <= value,
    inArray: (column: { name: string }, values: unknown[]) => (row: Record<string, unknown>) =>
      values.includes(row[column.name]),
    and:
      (...preds: Array<(row: Record<string, unknown>) => boolean>) =>
      (row: Record<string, unknown>) =>
        preds.every((p) => p(row)),
  };
});

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => Promise.resolve(roster.rows),
    }),
    selectDistinctOn: () => ({
      from: () => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => ({
          orderBy: async () => {
            // The same result a real `DISTINCT ON (employee_id) ORDER BY
            // employee_id, week DESC` produces: one row per employee, the
            // latest week among whatever the predicate let through.
            const filtered = assessments.rows.filter((r) => pred(r as unknown as Record<string, unknown>));
            const latest = new Map<string, (typeof assessments.rows)[number]>();
            for (const row of filtered) {
              const existing = latest.get(row.employee_id);
              if (!existing || row.week > existing.week) latest.set(row.employee_id, row);
            }
            return [...latest.values()];
          },
        }),
      }),
    }),
  },
}));

const { getEwsRiskCounts } = await import("./ews");

const period = (end: string): Period => ({ granularity: "month", start: "2026-01-01", end, label: "test" });

beforeEach(() => {
  roster.rows = [];
  assessments.rows = [];
});

describe("getEwsRiskCounts", () => {
  it("counts each risk level from everyone's latest assessment as of the cutoff", async () => {
    roster.rows = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
    assessments.rows = [
      { employee_id: "1", week: "2026-08-01", riskLevel: "BLACK" },
      { employee_id: "2", week: "2026-08-01", riskLevel: "RED" },
      { employee_id: "3", week: "2026-08-01", riskLevel: "YELLOW" },
      { employee_id: "4", week: "2026-08-01", riskLevel: "GREEN" },
    ];
    const counts = await getEwsRiskCounts(period("2026-08-31"));
    expect(counts).toEqual({ stable: 1, watch: 1, atRisk: 1, critical: 1, unassessed: 0 });
  });

  it("counts someone with no assessment at all as unassessed", async () => {
    roster.rows = [{ id: "1" }, { id: "2" }];
    assessments.rows = [{ employee_id: "1", week: "2026-08-01", riskLevel: "GREEN" }];
    const counts = await getEwsRiskCounts(period("2026-08-31"));
    expect(counts).toEqual({ stable: 1, watch: 0, atRisk: 0, critical: 0, unassessed: 1 });
  });

  it("ignores an assessment recorded after the period's end", async () => {
    roster.rows = [{ id: "1" }];
    assessments.rows = [
      { employee_id: "1", week: "2026-06-01", riskLevel: "RED" },
      { employee_id: "1", week: "2026-09-01", riskLevel: "GREEN" },
    ];
    const counts = await getEwsRiskCounts(period("2026-08-31"));
    // The June assessment is the latest one that had actually happened by the cutoff.
    expect(counts).toEqual({ stable: 0, watch: 0, atRisk: 1, critical: 0, unassessed: 0 });
  });

  it("picks the latest of several pre-cutoff assessments, not the first recorded", async () => {
    roster.rows = [{ id: "1" }];
    assessments.rows = [
      { employee_id: "1", week: "2026-06-01", riskLevel: "BLACK" },
      { employee_id: "1", week: "2026-07-01", riskLevel: "YELLOW" },
    ];
    const counts = await getEwsRiskCounts(period("2026-08-31"));
    expect(counts).toEqual({ stable: 0, watch: 1, atRisk: 0, critical: 0, unassessed: 0 });
  });

  it("returns all zero when there is no roster at all", async () => {
    roster.rows = [];
    const counts = await getEwsRiskCounts(period("2026-08-31"));
    expect(counts).toEqual({ stable: 0, watch: 0, atRisk: 0, critical: 0, unassessed: 0 });
  });
});
