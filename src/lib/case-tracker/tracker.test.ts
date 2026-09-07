import { describe, expect, it } from "vitest";
import { levenshtein, matchActivity, skillCodesForActivities } from "./activities";
import {
  activityNameFrom,
  blockHours,
  csvField,
  localDateString,
  minutesOfDay,
  parseScheduleLines,
  progressPercent,
  summarizeDay,
  timesOnLine,
  to24Hour,
  toCsv,
  type ActivityBlock,
  type LoggedCase,
  type SkillTarget,
} from "./tracker";

const target = (code: string, name: string, value: number, ramp: string | null = null): SkillTarget => ({
  code,
  name,
  target: value,
  rampStageLabel: ramp,
});

const TARGETS = new Map<string, SkillTarget>([
  ["fax", target("fax", "Fax", 11)],
  ["outreach", target("outreach", "Outreach", 9.5)],
]);

const block = (over: Partial<ActivityBlock> = {}): ActivityBlock => ({
  id: "b1",
  date: "2026-09-08",
  activity: "CSBO-PA-OGS Fax",
  start: "09:00",
  end: "12:00",
  skillCode: "fax",
  ...over,
});

const logged = (over: Partial<LoggedCase> = {}): LoggedCase => ({
  id: "c1",
  date: "2026-09-08",
  caseNumber: "PA-1",
  skillCode: "fax",
  decision: "Approved",
  activeApproval: "N",
  cancellationNote: "N",
  urgent: "N",
  quantityLimit: "Y",
  loggedAt: "2026-09-08 09:10",
  ...over,
});

describe("activity matching", () => {
  it("maps both Fax queues to the Fax skill", () => {
    expect(matchActivity("CSBO-PA-OGS Fax")).toMatchObject({ skillCode: "fax", exact: true });
    expect(matchActivity("CSBO-PA-CRG-Part D")).toMatchObject({ skillCode: "fax", exact: true });
  });

  it("maps chart checkers to GLP-1, not to a phone skill", () => {
    expect(matchActivity("CSBO-PA-CRG-Chart Checkers")).toMatchObject({ skillCode: "glp_1" });
  });

  it("covers the five skills the six activity codes span", () => {
    expect(skillCodesForActivities()).toEqual(["fax", "glp_1", "outreach", "edits", "ocn"]);
  });

  it("ignores punctuation and case the way the schedule renders it", () => {
    expect(matchActivity("csbo pa outreach")).toMatchObject({ skillCode: "outreach", exact: true });
  });

  it("reports a near miss as approximate rather than passing it off as exact", () => {
    // One edit from Part D, and not on the list at all. No threshold can
    // separate these, so the match must not claim to be certain.
    const match = matchActivity("CSBO-PA-CRG-Part B");
    expect(match).not.toBeNull();
    expect(match!.exact).toBe(false);
    expect(match!.distance).toBe(1);
  });

  it("never rewrites the caller's text", () => {
    // The returned value carries the code; the raw string stays the caller's.
    const raw = "CSBO-PA-CRG-Part B";
    expect(matchActivity(raw)?.activity).toBe("CSBO-PA-CRG-Part D");
    expect(raw).toBe("CSBO-PA-CRG-Part B");
  });

  it("refuses an unrelated activity", () => {
    expect(matchActivity("Lunch")).toBeNull();
    expect(matchActivity("Team Meeting")).toBeNull();
    expect(matchActivity("")).toBeNull();
  });

  it("measures edit distance", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("time reading", () => {
  it("reads a 24-hour clock", () => {
    expect(minutesOfDay("09:30")).toBe(570);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("24:00")).toBeNull();
    expect(minutesOfDay("nope")).toBeNull();
  });

  it("converts midnight and noon the way a 12-hour clock means them", () => {
    expect(to24Hour(12, 0, "a")).toBe("00:00");
    expect(to24Hour(12, 30, "p")).toBe("12:30");
    expect(to24Hour(1, 5, "p")).toBe("13:05");
    expect(to24Hour(9, 0, null)).toBe("09:00");
    expect(to24Hour(21, 0, null)).toBe("21:00");
  });

  it("rejects a 12-hour time outside 1-12 and a bad minute", () => {
    expect(to24Hour(13, 0, "p")).toBeNull();
    expect(to24Hour(9, 75, "a")).toBeNull();
  });

  it("finds every time on a line, in order, in either notation", () => {
    expect(timesOnLine("CSBO-PA-OGS Fax 9:00 AM 12:00 PM")).toEqual(["09:00", "12:00"]);
    expect(timesOnLine("Fax 09:00 17:30")).toEqual(["09:00", "17:30"]);
    expect(timesOnLine("Fax 9:00 A.M. 1:00 P.M.")).toEqual(["09:00", "13:00"]);
  });
});

describe("block hours", () => {
  it("measures an ordinary block", () => {
    expect(blockHours("09:00", "12:30")).toBe(3.5);
  });

  it("crosses midnight for a night shift", () => {
    expect(blockHours("22:00", "02:00")).toBe(4);
  });

  it("is zero for a block that starts and ends together", () => {
    expect(blockHours("09:00", "09:00")).toBe(0);
  });

  it("refuses an implausible span rather than banking a misread hour", () => {
    // "1:00 PM" misread as "1:00 AM" against a 09:00 start turns a four-hour
    // block into sixteen. Better to flag the row than to halve the day's rate.
    expect(blockHours("09:00", "01:00")).toBeNull();
  });

  it("refuses a malformed time", () => {
    expect(blockHours("9am", "noon")).toBeNull();
  });
});

describe("schedule line parsing", () => {
  it("takes the last two times on the line as start and end", () => {
    const [row] = parseScheduleLines([
      { text: "09/08/2026 CSBO-PA-OGS Fax 9:00 AM 12:00 PM", confidence: 91 },
    ]);
    expect(row).toMatchObject({ start: "09:00", end: "12:00", hours: 3, confidence: 91 });
    expect(row.match?.skillCode).toBe("fax");
  });

  it("keeps the scanned text beside the match", () => {
    const [row] = parseScheduleLines([{ text: "CSBO-PA-CRG-Part B 9:00 AM 10:00 AM" }]);
    expect(row.raw).toBe("CSBO PA CRG Part B");
    expect(row.match?.exact).toBe(false);
  });

  it("skips a line with fewer than two times", () => {
    expect(parseScheduleLines([{ text: "CSBO-PA-OGS Fax 9:00 AM" }])).toEqual([]);
    expect(parseScheduleLines([{ text: "" }])).toEqual([]);
  });

  it("strips a repeated time out of the name instead of leaving one behind", () => {
    expect(activityNameFrom("Fax 9:00 AM 9:00 AM")).toBe("Fax");
  });

  it("keeps an unmatched activity as a row so it can be seen and corrected", () => {
    const [row] = parseScheduleLines([{ text: "Lunch 12:00 PM 1:00 PM" }]);
    expect(row.match).toBeNull();
    expect(row.raw).toBe("Lunch");
  });
});

describe("the day", () => {
  it("holds each skill to its own target", () => {
    const day = summarizeDay(
      "2026-09-08",
      [
        block({ id: "b1", skillCode: "fax", start: "09:00", end: "11:00" }),
        block({ id: "b2", skillCode: "outreach", start: "13:00", end: "15:00" }),
      ],
      [],
      TARGETS,
    );

    const fax = day.skills.find((s) => s.skillCode === "fax")!;
    const outreach = day.skills.find((s) => s.skillCode === "outreach")!;
    expect(fax.required).toBe(22); // 2h x 11
    expect(outreach.required).toBe(19); // 2h x 9.5
    expect(day.totalRequired).toBe(41);
    // The blended goal is hours-weighted, not an average of the two targets.
    expect(day.blendedTarget).toBe(10.25);
  });

  it("counts a case against the skill it was worked on, not the day", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ skillCode: "fax", start: "09:00", end: "10:00" })],
      [logged({ id: "c1", skillCode: "fax" }), logged({ id: "c2", skillCode: "outreach" })],
      TARGETS,
    );

    expect(day.skills.find((s) => s.skillCode === "fax")!.cases).toBe(1);
    // Outreach has a case but no hours: it still appears, and its case is not
    // quietly added to the Fax rate.
    const outreach = day.skills.find((s) => s.skillCode === "outreach")!;
    expect(outreach.cases).toBe(1);
    expect(outreach.hours).toBe(0);
    expect(outreach.pace).toBeNull();
  });

  it("sets aside cases and hours that carry no target", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ skillCode: null }), block({ id: "b2", skillCode: "unknown", start: "13:00", end: "14:00" })],
      [logged({ skillCode: null })],
      TARGETS,
    );
    expect(day.totalHours).toBe(0);
    expect(day.untargetedHours).toBe(1);
    expect(day.unattributedCases).toBe(1);
    expect(day.totalCases).toBe(0);
  });

  it("says how many more cases the day still needs", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ skillCode: "fax", start: "09:00", end: "10:00" })],
      Array.from({ length: 4 }, (_, i) => logged({ id: `c${i}`, caseNumber: `PA-${i}` })),
      TARGETS,
    );
    expect(day.totalRequired).toBe(11);
    expect(day.remaining).toBe(7);
    expect(day.met).toBe(false);
    expect(day.pace).toBe(4);
  });

  it("is met once the cases reach the requirement", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ skillCode: "fax", start: "09:00", end: "10:00" })],
      Array.from({ length: 11 }, (_, i) => logged({ id: `c${i}`, caseNumber: `PA-${i}` })),
      TARGETS,
    );
    expect(day.met).toBe(true);
    expect(day.remaining).toBe(0);
    expect(progressPercent(day)).toBe(100);
  });

  it("uses a ramp target when one was chosen, and says so", () => {
    const ramping = new Map([["fax", target("fax", "Fax", 6.4, "Week 1")]]);
    const day = summarizeDay(
      "2026-09-08",
      [block({ skillCode: "fax", start: "09:00", end: "10:00" })],
      [],
      ramping,
    );
    const fax = day.skills[0];
    expect(fax.target).toBe(6.4);
    expect(fax.required).toBeCloseTo(6.4);
    expect(fax.rampStageLabel).toBe("Week 1");
  });

  it("has nothing to divide by on an empty day", () => {
    const day = summarizeDay("2026-09-08", [], [], TARGETS);
    expect(day.pace).toBeNull();
    expect(day.blendedTarget).toBeNull();
    expect(day.met).toBe(false);
    expect(progressPercent(day)).toBe(0);
  });

  it("ignores other days entirely", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ date: "2026-09-07" })],
      [logged({ date: "2026-09-07" })],
      TARGETS,
    );
    expect(day.totalHours).toBe(0);
    expect(day.totalCases).toBe(0);
  });

  it("drops an implausible block instead of counting sixteen hours", () => {
    const day = summarizeDay(
      "2026-09-08",
      [block({ start: "09:00", end: "01:00" })],
      [],
      TARGETS,
    );
    expect(day.totalHours).toBe(0);
  });
});

describe("csv", () => {
  it("defuses a field Excel would evaluate as a formula", () => {
    expect(csvField("=1+1")).toBe("\"'=1+1\"");
    expect(csvField("+PA-1")).toBe("\"'+PA-1\"");
    expect(csvField("@x")).toBe("\"'@x\"");
  });

  it("escapes embedded quotes and leaves ordinary text alone", () => {
    expect(csvField('a "b"')).toBe('"a ""b"""');
    expect(csvField("PA-102938")).toBe('"PA-102938"');
  });

  it("joins rows with CRLF, which is what Excel expects", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\r\n"c","d"');
  });
});

describe("local date", () => {
  it("uses the viewer's own calendar day, not UTC", () => {
    // 00:30 on the 8th in a +08:00 zone is still the 7th in UTC. The tracker
    // must open on the 8th.
    const local = new Date(2026, 8, 8, 0, 30);
    expect(localDateString(local)).toBe("2026-09-08");
  });
});
