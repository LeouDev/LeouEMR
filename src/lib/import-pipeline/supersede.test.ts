import { describe, expect, it } from "vitest";
import { supersedeRanges } from "./commit";

/**
 * The scope an import claims when it replaces earlier facts.
 *
 * Too wide and a second team's month disappears; too narrow and the bug this
 * exists for survives — two exports of the same month dated a day apart, whose
 * rows collide on nothing and so both stay.
 */
describe("supersedeRanges", () => {
  it("claims exactly one day for someone who appears on one day", () => {
    expect(supersedeRanges([{ employeeId: "a", factDate: "2026-08-04" }])).toEqual([
      { from: "2026-08-04", to: "2026-08-04", employeeIds: ["a"] },
    ]);
  });

  it("claims first to last for someone spanning a month", () => {
    const rows = [
      { employeeId: "a", factDate: "2026-08-20" },
      { employeeId: "a", factDate: "2026-08-01" },
      { employeeId: "a", factDate: "2026-08-31" },
    ];
    expect(supersedeRanges(rows)).toEqual([
      { from: "2026-08-01", to: "2026-08-31", employeeIds: ["a"] },
    ]);
  });

  it("never lets one employee's span widen another's", () => {
    // The whole file runs 1–31 August, but each person worked a single day.
    const ranges = supersedeRanges([
      { employeeId: "a", factDate: "2026-08-01" },
      { employeeId: "b", factDate: "2026-08-31" },
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges).toContainEqual({ from: "2026-08-01", to: "2026-08-01", employeeIds: ["a"] });
    expect(ranges).toContainEqual({ from: "2026-08-31", to: "2026-08-31", employeeIds: ["b"] });
  });

  it("groups employees who share a span into one statement", () => {
    const rows = ["a", "b", "c"].flatMap((employeeId) => [
      { employeeId, factDate: "2026-08-01" },
      { employeeId, factDate: "2026-08-31" },
    ]);
    const ranges = supersedeRanges(rows);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].employeeIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("covers the shifted-date case that caused the double count", () => {
    // The second export carries the same August a day later. Its span covers
    // the first import's rows, so committing it clears them.
    const second = [
      { employeeId: "a", factDate: "2026-08-05" },
      { employeeId: "a", factDate: "2026-08-21" },
    ];
    const [range] = supersedeRanges(second);
    const firstImportDates = ["2026-08-04", "2026-08-12", "2026-08-20"];
    const cleared = firstImportDates.filter((d) => d >= range.from && d <= range.to);
    expect(cleared).toEqual(["2026-08-12", "2026-08-20"]);
    // 2026-08-04 predates the second export's own first row, so it survives —
    // the import only speaks for the span it actually covers.
    expect(cleared).not.toContain("2026-08-04");
  });

  it("returns nothing for an empty file", () => {
    expect(supersedeRanges([])).toEqual([]);
  });
});
