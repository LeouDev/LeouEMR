import { describe, expect, it } from "vitest";
import { sustainedPassingKpis, type MatrixCell } from "./performance";

/**
 * A KPI drops off the development plan once it has passed the most recent
 * SUSTAINED_PASS_WEEKS (8) weeks in a row — the plan exists to show what
 * still needs work, not a long clean streak. These pin down the exact
 * window and the "too new / too shaky to judge" cases that must stay
 * visible rather than risk hiding something that isn't actually settled.
 */

const cell = (status: MatrixCell["status"]): MatrixCell => ({
  actualValue: 1,
  targetValue: 1,
  status,
  sampleSize: null,
});

/** 12 ascending week starts, W01 oldest .. W12 latest. */
const WEEKS = Array.from({ length: 12 }, (_, i) => `2026-W${String(i + 1).padStart(2, "0")}`);

function cellsFor(code: string, statuses: Array<MatrixCell["status"] | undefined>): Map<string, MatrixCell> {
  const cells = new Map<string, MatrixCell>();
  statuses.forEach((status, i) => {
    if (status !== undefined) cells.set(`${code}|${WEEKS[i]}`, cell(status));
  });
  return cells;
}

describe("sustainedPassingKpis", () => {
  it("hides a KPI that passed the most recent 8 weeks straight", () => {
    const statuses = [
      "fail", "fail", "fail", "fail",
      "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass",
    ] as const;
    const cells = cellsFor("FAX", [...statuses]);
    expect(sustainedPassingKpis(WEEKS, ["FAX"], cells)).toEqual(new Set(["FAX"]));
  });

  it("keeps a KPI visible when one of the last 8 weeks failed", () => {
    const statuses = [
      "pass", "pass", "pass", "pass",
      "pass", "pass", "fail", "pass", "pass", "pass", "pass", "pass",
    ] as const;
    const cells = cellsFor("FAX", [...statuses]);
    expect(sustainedPassingKpis(WEEKS, ["FAX"], cells)).toEqual(new Set());
  });

  it("keeps a KPI visible when one of the last 8 weeks is a warning, not a clean pass", () => {
    const statuses = [
      "pass", "pass", "pass", "pass",
      "warning", "pass", "pass", "pass", "pass", "pass", "pass", "pass",
    ] as const;
    const cells = cellsFor("FAX", [...statuses]);
    expect(sustainedPassingKpis(WEEKS, ["FAX"], cells)).toEqual(new Set());
  });

  it("keeps a KPI visible when a week in the window has no cell at all", () => {
    const statuses = [
      "pass", "pass", "pass", "pass",
      "pass", "pass", undefined, "pass", "pass", "pass", "pass", "pass",
    ] as const;
    const cells = cellsFor("FAX", [...statuses]);
    expect(sustainedPassingKpis(WEEKS, ["FAX"], cells)).toEqual(new Set());
  });

  it("keeps a KPI visible with fewer than 8 weeks of history, even if every one passed", () => {
    const shortWeeks = WEEKS.slice(0, 5);
    const cells = cellsFor("CASE_RATE", ["pass", "pass", "pass", "pass", "pass"]);
    expect(sustainedPassingKpis(shortWeeks, ["CASE_RATE"], cells)).toEqual(new Set());
  });

  it("judges each KPI independently — one sustained, one not, in the same call", () => {
    const cells = new Map([
      ...cellsFor("FAX", ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass"]),
      ...cellsFor("QUALITY", ["pass", "pass", "pass", "pass", "pass", "pass", "fail", "pass", "pass", "pass", "pass", "pass"]),
    ]);
    expect(sustainedPassingKpis(WEEKS, ["FAX", "QUALITY"], cells)).toEqual(new Set(["FAX"]));
  });

  it("looks only at the most recent 8 — an old streak broken since then does not exempt it", () => {
    // Passed weeks 1-8, then a fail at week 9, then passing again 10-12 —
    // only 3 clean weeks since the fail, well short of 8.
    const statuses = [
      "pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass",
      "fail", "pass", "pass", "pass",
    ] as const;
    const cells = cellsFor("FAX", [...statuses]);
    expect(sustainedPassingKpis(WEEKS, ["FAX"], cells)).toEqual(new Set());
  });
});
