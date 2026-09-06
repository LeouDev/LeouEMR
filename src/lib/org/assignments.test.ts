import { describe, expect, it } from "vitest";
import {
  type Assignment,
  type OrgWeek,
  assignmentOn,
  collapseWeeks,
  shiftDay,
  spliceAssignments,
} from "./assignments";

/**
 * The interval algebra behind dated org history.
 *
 * Getting this wrong is expensive and quiet: a bad splice does not throw, it
 * just attributes someone's numbers to the wrong supervisor months later. The
 * cases here are the ones that actually occur — a realignment mid-month, a
 * month re-imported after a correction, an older file uploaded after a newer
 * one, and a person who moves twice.
 */

const LEA = { supervisorEid: "S1", supervisorName: "Lea", managerName: "Leou", site: "Manila" };
const LOVELY = {
  supervisorEid: "S2",
  supervisorName: "Lovely",
  managerName: "Leou",
  site: "Manila",
};

function week(weekStart: string, org: typeof LEA): OrgWeek {
  return { weekStart, weekEnd: shiftDay(weekStart, 6), ...org };
}

// Saturday-Friday weeks, matching the source "WE" labels.
const AUG_1 = "2026-08-01";
const AUG_8 = "2026-08-08";
const AUG_15 = "2026-08-15";
const AUG_22 = "2026-08-22";
const AUG_29 = "2026-08-29";
const SEP_5 = "2026-09-05";

describe("shiftDay", () => {
  it("crosses a month boundary", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("crosses a leap day", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("does not drift by timezone", () => {
    // Parsed as UTC on purpose: a local-time parse shifts the date by one in
    // any negative-offset zone, which would silently misdate every interval.
    expect(shiftDay("2026-01-01", 0)).toBe("2026-01-01");
  });
});

describe("collapseWeeks", () => {
  it("merges consecutive weeks with the same structure into one interval", () => {
    const result = collapseWeeks([week(AUG_1, LEA), week(AUG_8, LEA), week(AUG_15, LEA)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ effectiveFrom: AUG_1, effectiveTo: "2026-08-21" });
  });

  it("splits at a realignment and leaves no overlap", () => {
    const result = collapseWeeks([
      week(AUG_1, LEA),
      week(AUG_8, LEA),
      week(AUG_15, LOVELY),
      week(AUG_22, LOVELY),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      supervisorName: "Lea",
      effectiveFrom: AUG_1,
      effectiveTo: "2026-08-14",
    });
    expect(result[1]).toMatchObject({
      supervisorName: "Lovely",
      effectiveFrom: AUG_15,
      effectiveTo: "2026-08-28",
    });
  });

  it("does not treat a missing week as a move away and back", () => {
    // A week with no rows means the file said nothing, not that the person
    // changed teams for a week.
    const result = collapseWeeks([week(AUG_1, LEA), week(AUG_22, LEA)]);
    expect(result).toHaveLength(1);
    expect(result[0].effectiveTo).toBe("2026-08-28");
  });

  it("handles a person who moves twice in one file", () => {
    const result = collapseWeeks([
      week(AUG_1, LEA),
      week(AUG_8, LOVELY),
      week(AUG_15, LEA),
    ]);
    expect(result.map((r) => r.supervisorName)).toEqual(["Lea", "Lovely", "Lea"]);
    expect(result.map((r) => r.effectiveFrom)).toEqual([AUG_1, AUG_8, AUG_15]);
  });

  it("is insensitive to the order the weeks arrive in", () => {
    const forward = collapseWeeks([week(AUG_1, LEA), week(AUG_8, LOVELY)]);
    const reversed = collapseWeeks([week(AUG_8, LOVELY), week(AUG_1, LEA)]);
    expect(reversed).toEqual(forward);
  });

  it("does not rewind an interval when a week appears twice", () => {
    // The same week can arrive from more than one sheet.
    const result = collapseWeeks([week(AUG_1, LEA), week(AUG_8, LEA), week(AUG_1, LEA)]);
    expect(result).toHaveLength(1);
    expect(result[0].effectiveTo).toBe("2026-08-14");
  });

  it("returns nothing for no weeks", () => {
    expect(collapseWeeks([])).toEqual([]);
  });
});

describe("spliceAssignments", () => {
  const open = (from: string, org: typeof LEA): Assignment => ({
    effectiveFrom: from,
    effectiveTo: null,
    ...org,
  });

  it("records a realignment without disturbing earlier history", () => {
    const existing = [open(AUG_1, LEA)];
    const incoming = collapseWeeks([week(AUG_29, LOVELY), week(SEP_5, LOVELY)]);
    const result = spliceAssignments(existing, incoming, AUG_29, "2026-09-11");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      supervisorName: "Lea",
      effectiveFrom: AUG_1,
      effectiveTo: "2026-08-28",
    });
    // The newest interval is always open: the source never states an end.
    expect(result[1]).toMatchObject({
      supervisorName: "Lovely",
      effectiveFrom: AUG_29,
      effectiveTo: null,
    });
  });

  it("is idempotent — re-importing the same file changes nothing", () => {
    const incoming = collapseWeeks([week(AUG_29, LOVELY), week(SEP_5, LOVELY)]);
    const once = spliceAssignments([open(AUG_1, LEA)], incoming, AUG_29, "2026-09-11");
    const twice = spliceAssignments(once, incoming, AUG_29, "2026-09-11");
    expect(twice).toEqual(once);
  });

  it("lets a correction overwrite a month already imported", () => {
    const existing = spliceAssignments(
      [open(AUG_1, LEA)],
      collapseWeeks([week(AUG_29, LOVELY)]),
      AUG_29,
      "2026-09-04",
    );
    // The re-upload says that week was Lea's after all.
    const corrected = spliceAssignments(
      existing,
      collapseWeeks([week(AUG_29, LEA)]),
      AUG_29,
      "2026-09-04",
    );
    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({ supervisorName: "Lea", effectiveTo: null });
  });

  it("supersedes an open claim rather than resuming it afterwards", () => {
    // "Lea from August, until told otherwise" says nothing about the weeks
    // after the window we were just told about, so Lea must not reappear as a
    // tail. The newest week imported sets the current assignment — the same
    // last-import-wins rule the employees table has always followed.
    const existing = [open(AUG_1, LEA)];
    const result = spliceAssignments(
      existing,
      collapseWeeks([week(AUG_15, LOVELY)]),
      AUG_15,
      "2026-08-21",
    );
    expect(result.map((r) => [r.supervisorName, r.effectiveFrom, r.effectiveTo])).toEqual([
      ["Lea", AUG_1, "2026-08-14"],
      ["Lovely", AUG_15, null],
    ]);
  });

  it("keeps the tail of a closed interval, which is a real claim", () => {
    // Unlike an open interval, "Lea from 1 to 28 August" positively covers the
    // days after an inner window, so they must survive the cut.
    const existing: Assignment[] = [{ effectiveFrom: AUG_1, effectiveTo: "2026-08-28", ...LEA }];
    const result = spliceAssignments(
      existing,
      collapseWeeks([week(AUG_8, LOVELY)]),
      AUG_8,
      "2026-08-14",
    );
    expect(result.map((r) => [r.supervisorName, r.effectiveFrom, r.effectiveTo])).toEqual([
      ["Lea", AUG_1, "2026-08-07"],
      ["Lovely", AUG_8, "2026-08-14"],
      ["Lea", "2026-08-15", null],
    ]);
  });

  it("does not let an older file clobber a newer assignment", () => {
    // September already imported; August uploaded afterwards must only affect
    // August. This is the case that silently rewrites the present if the
    // splice is implemented as "replace everything".
    const withSeptember = spliceAssignments(
      [open(AUG_1, LEA)],
      collapseWeeks([week(AUG_29, LOVELY), week(SEP_5, LOVELY)]),
      AUG_29,
      "2026-09-11",
    );
    const thenAugust = spliceAssignments(
      withSeptember,
      collapseWeeks([week(AUG_1, LEA), week(AUG_8, LEA)]),
      AUG_1,
      "2026-08-14",
    );
    const current = thenAugust[thenAugust.length - 1];
    expect(current).toMatchObject({ supervisorName: "Lovely", effectiveTo: null });
  });

  it("merges abutting intervals that say the same thing", () => {
    const result = spliceAssignments(
      [{ effectiveFrom: AUG_1, effectiveTo: "2026-08-28", ...LEA }],
      collapseWeeks([week(AUG_29, LEA)]),
      AUG_29,
      "2026-09-04",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ effectiveFrom: AUG_1, effectiveTo: null });
  });

  it("keeps intervals disjoint in every case", () => {
    const result = spliceAssignments(
      [open(AUG_1, LEA)],
      collapseWeeks([week(AUG_8, LOVELY), week(AUG_15, LEA), week(AUG_22, LOVELY)]),
      AUG_8,
      "2026-08-28",
    );
    for (let i = 0; i < result.length - 1; i += 1) {
      expect(result[i].effectiveTo).not.toBeNull();
      expect(result[i].effectiveTo! < result[i + 1].effectiveFrom).toBe(true);
    }
  });

  it("seeds history when there is none", () => {
    const incoming = collapseWeeks([week(AUG_1, LEA)]);
    const result = spliceAssignments([], incoming, AUG_1, "2026-08-07");
    expect(result).toEqual([{ effectiveFrom: AUG_1, effectiveTo: null, ...LEA }]);
  });

  it("leaves history alone when the import covers nobody", () => {
    const existing = [open(AUG_1, LEA)];
    expect(spliceAssignments(existing, [], AUG_1, "2026-08-07")).toEqual([
      { effectiveFrom: AUG_1, effectiveTo: null, ...LEA },
    ]);
  });
});

describe("assignmentOn", () => {
  const history: Assignment[] = [
    { effectiveFrom: AUG_1, effectiveTo: "2026-08-28", ...LEA },
    { effectiveFrom: AUG_29, effectiveTo: null, ...LOVELY },
  ];

  it("finds the supervisor of record for a past week", () => {
    expect(assignmentOn(history, AUG_15)?.supervisorName).toBe("Lea");
  });

  it("is inclusive at both ends of an interval", () => {
    expect(assignmentOn(history, AUG_1)?.supervisorName).toBe("Lea");
    expect(assignmentOn(history, "2026-08-28")?.supervisorName).toBe("Lea");
    expect(assignmentOn(history, AUG_29)?.supervisorName).toBe("Lovely");
  });

  it("treats the open interval as covering every later date", () => {
    expect(assignmentOn(history, "2027-01-01")?.supervisorName).toBe("Lovely");
  });

  it("returns null before the history starts, rather than guessing", () => {
    expect(assignmentOn(history, "2026-07-31")).toBeNull();
  });
});
