import { describe, expect, it } from "vitest";
import { parseWeekLabel } from "./columns";
import { weekForRow } from "./week-placement";

describe("weekForRow", () => {
  const label = parseWeekLabel("WE 09/04/26"); // Sat Aug 29 – Fri Sep 4 by the label

  it("places a dated row in the Sunday-to-Saturday week containing its date", () => {
    expect(weekForRow(label, "2026-09-01")).toEqual({
      weekStart: "2026-08-30",
      weekEnd: "2026-09-05",
      byLabel: false,
    });
  });

  it("moves the label's Saturday into the previous reporting week", () => {
    // The label says Aug 29 – Sep 4; Sat Aug 29 is the end of the operation's week
    // Aug 23 – Aug 29, not the start of this one.
    expect(weekForRow(label, "2026-08-29")).toMatchObject({
      weekStart: "2026-08-23",
      weekEnd: "2026-08-29",
    });
  });

  it("uses the date even when the label disagrees outright", () => {
    expect(weekForRow(parseWeekLabel("WE 08/07/26"), "2026-09-15")).toMatchObject({
      weekStart: "2026-09-13",
    });
  });

  it("falls back to the week containing the label's Friday for an undated row, and says so", () => {
    expect(weekForRow(label, null)).toEqual({
      weekStart: "2026-08-30",
      weekEnd: "2026-09-05",
      byLabel: true,
    });
  });

  it("keeps the label's Saturday-to-Friday week before the cut-over", () => {
    const legacy = parseWeekLabel("WE 05/15/26");
    expect(weekForRow(legacy, "2026-05-12")).toEqual({
      weekStart: "2026-05-09",
      weekEnd: "2026-05-15",
      byLabel: false,
    });
    expect(weekForRow(legacy, null)).toMatchObject({ weekStart: "2026-05-09", byLabel: false });
  });

  it("puts the last legacy week's rows, dated or not, in the extended eight-day week", () => {
    expect(weekForRow(parseWeekLabel("WE 05/29/26"), "2026-05-27")).toMatchObject({
      weekStart: "2026-05-23",
      weekEnd: "2026-05-30",
      byLabel: false,
    });
    expect(weekForRow(parseWeekLabel("WE 05/29/26"), null)).toMatchObject({
      weekStart: "2026-05-23",
      weekEnd: "2026-05-30",
      byLabel: true,
    });
    // The label "WE 06/05/26" covers May 30 – Jun 5; a row dated May 30 belongs to the extended week.
    expect(weekForRow(parseWeekLabel("WE 06/05/26"), "2026-05-30")).toMatchObject({
      weekStart: "2026-05-23",
      weekEnd: "2026-05-30",
    });
    expect(weekForRow(parseWeekLabel("WE 06/05/26"), null)).toMatchObject({
      weekStart: "2026-05-31",
      weekEnd: "2026-06-06",
      byLabel: true,
    });
  });

  it("is null with neither a label nor a date in the re-cut range", () => {
    expect(weekForRow(null, null)).toBeNull();
    expect(weekForRow(null, "2026-05-01")).toBeNull();
  });
});
