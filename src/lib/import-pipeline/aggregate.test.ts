import { describe, expect, it } from "vitest";
import { aggregateWorkbook } from "./aggregate";
import { parseWeekLabel, resolveColumns } from "./columns";

describe("parseWeekLabel", () => {
  it("parses the source workbook's week-ending label", () => {
    expect(parseWeekLabel("WE 08/28/26")).toEqual({
      weekStart: "2026-08-22",
      weekEnd: "2026-08-28",
    });
  });

  it("rejects labels it cannot read rather than guessing a week", () => {
    expect(parseWeekLabel("")).toBeNull();
    expect(parseWeekLabel("Steady")).toBeNull();
    expect(parseWeekLabel(undefined)).toBeNull();
    expect(parseWeekLabel("WE 13/45/26")).toBeNull();
  });
});

describe("resolveColumns", () => {
  it("matches headers regardless of case, spacing and punctuation", () => {
    const resolved = resolveColumns(["Current Sup EID", "EMPLOYEENAME", "Deputy Manager"], {
      supervisorEid: ["Current Sup EID"],
      name: ["EMPLOYEENAME"],
      managerName: ["DeputyManager"],
    });
    expect(resolved).toEqual({
      supervisorEid: "Current Sup EID",
      name: "EMPLOYEENAME",
      managerName: "Deputy Manager",
    });
  });

  it("uses candidate priority order when a sheet has several usable headers", () => {
    const resolved = resolveColumns(["Supervisor", "Current Supervisor"], {
      supervisorName: ["Current Supervisor", "Supervisor"],
    });
    expect(resolved.supervisorName).toBe("Current Supervisor");
  });
});

describe("aggregateWorkbook", () => {
  const week = "WE 08/07/26";

  it("computes CPH and AHT from weekly totals, not an average of daily ratios", () => {
    const result = aggregateWorkbook({
      Productivity: [
        { EID: "1", EMPLOYEENAME: "A", Weekly: week, CASESCOMPLETED: 10, PRODUCTIVITYHOUR: 1, CPHTarget: 11, AHTTarget: 327 },
        { EID: "1", EMPLOYEENAME: "A", Weekly: week, CASESCOMPLETED: 30, PRODUCTIVITYHOUR: 3, CPHTarget: 11, AHTTarget: 327 },
      ],
    });

    const cph = result.metrics.find((m) => m.kpiCode === "CPH");
    const aht = result.metrics.find((m) => m.kpiCode === "AHT");

    // 40 cases over 4 hours = 10 CPH, and 4h/40 cases = 360s AHT.
    expect(cph?.actualValue).toBeCloseTo(10, 6);
    expect(aht?.actualValue).toBeCloseTo(360, 6);
    expect(cph?.targetValue).toBeCloseTo(11, 6);
    expect(aht?.targetValue).toBeCloseTo(327, 6);
  });

  it("averages quality scores into a percentage", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: week, Score: 1 },
        { EID: "1", AgentName: "A", Weekly: week, Score: 0.9 },
      ],
    });
    const quality = result.metrics.find((m) => m.kpiCode === "QUALITY");
    expect(quality?.actualValue).toBeCloseTo(95, 6);
    expect(quality?.sampleSize).toBe(2);
  });

  it("computes NPS as the mean of promoter/detractor scores", () => {
    const result = aggregateWorkbook({
      NPS: [
        { EID: "1", "Employee Name": "A", Week: week, NPS: 100 },
        { EID: "1", "Employee Name": "A", Week: week, NPS: 100 },
        { EID: "1", "Employee Name": "A", Week: week, NPS: -100 },
        { EID: "1", "Employee Name": "A", Week: week, NPS: 0 },
      ],
    });
    const nps = result.metrics.find((m) => m.kpiCode === "NPS");
    expect(nps?.actualValue).toBeCloseTo(25, 6);
  });

  it("counts attendance only over days the employee was expected in", () => {
    const result = aggregateWorkbook({
      Attendance: [
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 1, ABSENT: 0, STATUS: "P" },
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 1, ABSENT: 0, STATUS: "P" },
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 1, ABSENT: 0, STATUS: "P" },
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 0, ABSENT: 1, STATUS: "Abs" },
        // OFF and PTO days are neither present nor absent and must not dilute the rate.
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 0, ABSENT: 0, STATUS: "OFF" },
        { EID: "1", FULLNAME: "A", WEEKLY: week, PRESENT: 0, ABSENT: 0, STATUS: "PTO" },
      ],
    });
    const attendance = result.metrics.find((m) => m.kpiCode === "ATTENDANCE");
    expect(attendance?.actualValue).toBeCloseTo(75, 6); // 3 of 4 expected days
    expect(attendance?.sampleSize).toBe(4);
  });

  it("counts only critical compliance incidents", () => {
    const result = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Critical IO" },
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Critical IO" },
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Standard IO" },
      ],
    });
    const errors = result.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS");
    expect(errors?.actualValue).toBe(2);
  });

  it("separates weeks and employees", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: "WE 08/07/26", Score: 1 },
        { EID: "1", AgentName: "A", Weekly: "WE 08/14/26", Score: 0.8 },
        { EID: "2", AgentName: "B", Weekly: "WE 08/07/26", Score: 0.9 },
      ],
    });

    expect(result.metrics).toHaveLength(3);
    expect(result.weeks).toEqual(["2026-08-02", "2026-08-09"]);
    expect(result.employees.map((e) => e.eid).sort()).toEqual(["1", "2"]);
  });

  it("places each dated row by its own date, not the week label", () => {
    // The label says Sat Aug 29 – Fri Sep 4; the operation's weeks run
    // Sunday to Saturday, so Sat Aug 29 belongs to the week before.
    const result = aggregateWorkbook({
      Productivity: [
        { EID: "1", EMPLOYEENAME: "A", Weekly: "WE 09/04/26", DATECOMPLETED: "2026-08-29", CASESCOMPLETED: 10, PRODUCTIVITYHOUR: 1 },
        { EID: "1", EMPLOYEENAME: "A", Weekly: "WE 09/04/26", DATECOMPLETED: "2026-08-31", CASESCOMPLETED: 20, PRODUCTIVITYHOUR: 1 },
        { EID: "1", EMPLOYEENAME: "A", Weekly: "WE 09/04/26", DATECOMPLETED: "2026-09-05", CASESCOMPLETED: 30, PRODUCTIVITYHOUR: 1 },
      ],
    });

    expect(result.weeks).toEqual(["2026-08-23", "2026-08-30"]);
    const cph = result.metrics.filter((m) => m.kpiCode === "CPH").map((m) => [m.weekStart, m.weekEnd, m.actualValue]);
    expect(cph).toEqual([
      ["2026-08-23", "2026-08-29", 10],
      ["2026-08-30", "2026-09-05", 25],
    ]);
    expect(result.issues.filter((i) => i.severity === "warning" && i.sheet === "Productivity")).toHaveLength(0);
  });

  it("places an undated row by its label and says how many rows it had to", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: "WE 09/04/26", Date: "2026-09-02", Score: 0.9 },
        { EID: "1", AgentName: "A", Weekly: "WE 09/04/26", Date: "", Score: 1 },
      ],
    });

    expect(result.weeks).toEqual(["2026-08-30"]);
    expect(result.issues).toContainEqual({
      severity: "warning",
      sheet: "Quality",
      message:
        "Rows with no readable date were placed by their week label (the Sunday-to-Saturday week containing the label's Friday)",
      count: 1,
    });
  });

  it("reports rows it skipped instead of dropping them silently", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: week, Score: 1 },
        { EID: "", AgentName: "No ID", Weekly: week, Score: 1 },
        { EID: "3", AgentName: "Bad week", Weekly: "n/a", Score: 1 },
      ],
    });

    const summary = result.sheets.find((s) => s.sheet === "Quality");
    expect(summary).toMatchObject({ rowsRead: 3, rowsUsed: 1, rowsSkipped: 2 });
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(2);
  });

  it("captures the org hierarchy from whichever headers a sheet happens to use", () => {
    const result = aggregateWorkbook({
      Productivity: [
        {
          EID: "1",
          EMPLOYEENAME: "Person A",
          "Sup EID": "900",
          SUPERVISOR: "Sup One",
          Manager: "Mgr One",
          SITELOCATION: "CEBU",
          Weekly: week,
          CASESCOMPLETED: 10,
          PRODUCTIVITYHOUR: 1,
        },
      ],
    });

    expect(result.employees[0]).toMatchObject({
      eid: "1",
      name: "Person A",
      // Padded to the nine digits every EID match compares on.
      supervisorEid: "000000900",
      supervisorName: "Sup One",
      managerName: "Mgr One",
      site: "CEBU",
    });
  });

  it("fills a supervisor's EID from another sheet when the last one read names them without it", () => {
    // Attendance is read after Productivity, and its row has a Supervisor
    // column but no Sup EID column — the shape that used to leave the week
    // with a name and no EID, reaching nobody's account.
    const result = aggregateWorkbook({
      Productivity: [
        {
          EID: "1",
          EMPLOYEENAME: "Person A",
          "Sup EID": "001305110",
          SUPERVISOR: "Lea Ibag Fernandez",
          Weekly: week,
          CASESCOMPLETED: 10,
          PRODUCTIVITYHOUR: 1,
        },
      ],
      Attendance: [
        { EID: "1", EMPLOYEENAME: "Person A", SUPERVISOR: "Lea Ibag Fernandez", Weekly: week, PRESENT: 1 },
        { EID: "2", EMPLOYEENAME: "Person B", SUPERVISOR: "Lea Ibag Fernandez", Weekly: week, PRESENT: 1 },
        { EID: "3", EMPLOYEENAME: "Person C", SUPERVISOR: "Someone Else", Weekly: week, PRESENT: 1 },
      ],
    });

    const byEid = new Map(result.orgWeeks.map((w) => [w.eid, w]));
    expect(byEid.get("1")?.supervisorEid).toBe("001305110");
    // Person B never had an EID on any sheet, but the name is known.
    expect(byEid.get("2")?.supervisorEid).toBe("001305110");
    // A name no sheet ever pairs with an EID stays as it came.
    expect(byEid.get("3")?.supervisorEid).toBeNull();
    expect(result.employees.find((e) => e.eid === "2")?.supervisorEid).toBe("001305110");
  });

  it("warns about sheets it does not recognize rather than failing the import", () => {
    const result = aggregateWorkbook({
      Quality: [{ EID: "1", AgentName: "A", Weekly: week, Score: 1 }],
      "Calculated Field": [{ "Calculated Field": "Solve Order" }],
    });
    expect(result.unrecognizedSheets).toContain("Calculated Field");
    expect(result.metrics).toHaveLength(1);
  });
});

describe("PAR/MBO inputs", () => {
  const week = "WE 08/07/26";

  it("accumulates per-skill totals and keeps the row's own target", () => {
    const result = aggregateWorkbook({
      Productivity: [
        { EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "Fax", Weekly: week, CASESCOMPLETED: 10, PRODUCTIVITYHOUR: 1, CPHTarget: 6.4 },
        { EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "Fax", Weekly: week, CASESCOMPLETED: 20, PRODUCTIVITYHOUR: 2, CPHTarget: 6.4 },
      ],
    });

    expect(result.skillWeeks).toHaveLength(1);
    expect(result.skillWeeks[0]).toMatchObject({
      eid: "1",
      skillType: "Fax",
      cases: 30,
      hours: 3,
      // The ramp target from the row, not the skill's steady-state default.
      cphTarget: 6.4,
    });
  });

  it("separates skills within the same employee-week", () => {
    const result = aggregateWorkbook({
      Productivity: [
        { EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "Fax", Weekly: week, CASESCOMPLETED: 10, PRODUCTIVITYHOUR: 1 },
        { EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "OCN", Weekly: week, CASESCOMPLETED: 5, PRODUCTIVITYHOUR: 1 },
      ],
    });
    expect(result.skillWeeks.map((s) => s.skillType).sort()).toEqual(["Fax", "OCN"]);
  });

  it("tallies audits per skill, since DPO weights each by its own skill", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: week, SkillSet: "Edits", Score: 1, TotalMarkdown: 0 },
        { EID: "1", AgentName: "A", Weekly: week, SkillSet: "Edits", Score: 0.94, TotalMarkdown: 1 },
        { EID: "1", AgentName: "A", Weekly: week, SkillSet: "Fax", Score: 1, TotalMarkdown: 0 },
      ],
    });

    expect(result.qualityWeeks[0].bySkill).toEqual({
      Edits: { audits: 2, imperfect: 1, markdowns: 1 },
      Fax: { audits: 1, imperfect: 0, markdowns: 0 },
    });
  });

  it("keeps the score per skill and day, so phone and ancillary quality can be told apart", () => {
    const result = aggregateWorkbook({
      Quality: [
        { EID: "1", AgentName: "A", Weekly: week, Date: "2026-08-03", SkillSet: "Edits", Score: 1, TotalMarkdown: 0 },
        { EID: "1", AgentName: "A", Weekly: week, Date: "2026-08-03", SkillSet: "Edits", Score: 0.94, TotalMarkdown: 1 },
        { EID: "1", AgentName: "A", Weekly: week, Date: "2026-08-03", SkillSet: "Gen_Phones", Score: 0.9, TotalMarkdown: 2 },
      ],
    });

    expect(result.qualityFacts).toEqual([
      { eid: "1", skillLabel: "Edits", factDate: "2026-08-03", audits: 2, imperfect: 1, markdowns: 1, scoreSum: 1.94 },
      { eid: "1", skillLabel: "Gen_Phones", factDate: "2026-08-03", audits: 1, imperfect: 1, markdowns: 2, scoreSum: 0.9 },
    ]);
  });
});

describe("compliance severity", () => {
  const week = "WE 08/07/26";

  it("prefers an exact header when two normalize identically", () => {
    // The real workbook carries both: a 0/1 flag and a label.
    const resolved = resolveColumns(["Compliance Risk", "ComplianceRisk"], {
      risk: ["ComplianceRisk", "Compliance Risk"],
    });
    expect(resolved.risk).toBe("ComplianceRisk");
  });

  it("reads severity from the label form", () => {
    const result = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Critical IO" },
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Standard IO" },
      ],
    });
    expect(result.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS")?.actualValue).toBe(1);
  });

  it("reads severity from the 0/1 flag form", () => {
    const result = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, "Compliance Risk": 1 },
        { EID: "1", AgentName: "A", Weekly: week, "Compliance Risk": 1 },
        { EID: "1", AgentName: "A", Weekly: week, "Compliance Risk": 0 },
      ],
    });
    expect(result.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS")?.actualValue).toBe(2);
  });

  it("agrees across both forms for the same incidents", () => {
    const byLabel = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Critical IO" },
        { EID: "1", AgentName: "A", Weekly: week, ComplianceRisk: "Standard IO" },
      ],
    });
    const byFlag = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, "Compliance Risk": 1 },
        { EID: "1", AgentName: "A", Weekly: week, "Compliance Risk": 0 },
      ],
    });
    expect(byLabel.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS")?.actualValue).toBe(
      byFlag.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS")?.actualValue,
    );
  });
});

describe("target units", () => {
  const week = "WE 08/07/26";

  it("keeps both targets, because they are not interchangeable", () => {
    const result = aggregateWorkbook({
      Productivity: [
        {
          EID: "1",
          EMPLOYEENAME: "A",
          SKILLTYPE: "General Phone",
          Weekly: week,
          CASESCOMPLETED: 10,
          PRODUCTIVITYHOUR: 1,
          CPHTarget: 6.99,
          AHTTarget: 515,
        },
      ],
    });

    // A lower-is-better skill is scored in seconds per case and needs the
    // AHT target; scoring it against ~7 cases/hour would be ~70x off.
    expect(result.skillWeeks[0]).toMatchObject({ cphTarget: 6.99, ahtTarget: 515 });
  });
});

describe("PAR weighting basis", () => {
  const week = "WE 08/07/26";

  it("keeps productive hours and scheduled hours apart", () => {
    const result = aggregateWorkbook({
      Productivity: [
        {
          EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "Fax", Weekly: week,
          CASESCOMPLETED: 20, PRODUCTIVITYHOUR: 2, "IEX Prod Hours": 3, CPHTarget: 11,
        },
      ],
    });

    // The rate is measured over productive hours; the weighting uses IEX.
    expect(result.skillWeeks[0]).toMatchObject({ cases: 20, hours: 2, weightHours: 3 });
  });

  it("falls back to productive hours when the source has no IEX figure", () => {
    const result = aggregateWorkbook({
      Productivity: [
        {
          EID: "1", EMPLOYEENAME: "A", SKILLTYPE: "Fax", Weekly: week,
          CASESCOMPLETED: 20, PRODUCTIVITYHOUR: 2, CPHTarget: 11,
        },
      ],
    });
    expect(result.skillWeeks[0]).toMatchObject({ hours: 2, weightHours: 2 });
  });
});

describe("NPS response mix", () => {
  const row = (eid: string, date: string, nps: number) => ({
    EID: eid,
    Weekly: "WE 08/28/26",
    Date: date,
    NPS: nps,
  });

  it("tallies promoters, passives and detractors per employee-day", () => {
    const result = aggregateWorkbook({
      NPS: [
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-24", 0),
        row("001895123", "2026-08-24", -100),
      ],
    });

    expect(result.npsFacts).toHaveLength(1);
    expect(result.npsFacts[0]).toMatchObject({
      eid: "001895123",
      factDate: "2026-08-24",
      promoters: 2,
      passives: 1,
      detractors: 1,
    });
  });

  it("keeps each employee-day separate", () => {
    const result = aggregateWorkbook({
      NPS: [
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-25", -100),
        row("002258045", "2026-08-24", 0),
      ],
    });

    expect(result.npsFacts).toHaveLength(3);
    const byKey = new Map(result.npsFacts.map((f) => [`${f.eid}|${f.factDate}`, f]));
    expect(byKey.get("001895123|2026-08-24")).toMatchObject({ promoters: 1, detractors: 0 });
    expect(byKey.get("001895123|2026-08-25")).toMatchObject({ promoters: 0, detractors: 1 });
    expect(byKey.get("002258045|2026-08-24")).toMatchObject({ passives: 1 });
  });

  it("agrees with the score the same rows produce", () => {
    // 3 promoters, 1 detractor of 5 → (3-1)/5 = 40
    const result = aggregateWorkbook({
      NPS: [
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-24", 100),
        row("001895123", "2026-08-24", 0),
        row("001895123", "2026-08-24", -100),
      ],
    });

    const mix = result.npsFacts[0];
    const score = ((mix.promoters - mix.detractors) / (mix.promoters + mix.passives + mix.detractors)) * 100;
    const reported = result.metrics.find((m) => m.kpiCode === "NPS");
    expect(score).toBe(40);
    expect(reported?.actualValue).toBeCloseTo(40, 6);
  });

  it("ignores rows with no readable date, since a fact needs a day", () => {
    const result = aggregateWorkbook({
      NPS: [{ EID: "001895123", Weekly: "WE 08/28/26", NPS: 100 }],
    });
    expect(result.npsFacts).toHaveLength(0);
  });
});

describe("CPH and AHT follow the skill's own formula", () => {
  const metrics = new Map<string, "cph" | "aht" | "case_rate">([
    ["edits", "cph"],
    ["partdphones", "aht"],
    ["fax", "case_rate"],
  ]);

  const row = (skill: string) => ({
    EID: "001524032",
    Weekly: "WE 08/28/26",
    "Date Completed": "2026-08-24",
    SkillType: skill,
    "Cases Completed": 100,
    "Productivity Hour": 12.5,
    "CPH Target": 8,
    "AHT Target": 450,
  });

  const codesFor = (skill: string) => {
    const result = aggregateWorkbook({ Productivity: [row(skill)] }, metrics);
    return new Set(result.metrics.map((m) => m.kpiCode));
  };

  it("scores a cases-per-hour skill on CPH only", () => {
    const codes = codesFor("Edits");
    expect(codes.has("CPH")).toBe(true);
    // 12.5 hours over 100 cases is 450 seconds per case — arithmetically real,
    // but not what an Edits agent is measured on, and it opened action items.
    expect(codes.has("AHT")).toBe(false);
  });

  it("scores a handle-time skill on AHT only", () => {
    const codes = codesFor("PartD_Phones");
    expect(codes.has("AHT")).toBe(true);
    expect(codes.has("CPH")).toBe(false);
  });

  it("scores a case-rate skill on neither, since PAR carries its production", () => {
    const codes = codesFor("Fax");
    expect(codes.has("CPH")).toBe(false);
    expect(codes.has("AHT")).toBe(false);
  });

  it("matches skill labels regardless of case and punctuation", () => {
    expect(codesFor("partd phones").has("AHT")).toBe(true);
    expect(codesFor("PARTD-PHONES").has("CPH")).toBe(false);
  });

  it("keeps both for an unmapped skill rather than silently dropping it", () => {
    // Losing data for a label we have simply not mapped would hide the gap
    // instead of correcting it.
    const codes = codesFor("Some New Queue");
    expect(codes.has("CPH")).toBe(true);
    expect(codes.has("AHT")).toBe(true);
  });

  it("keeps both when no skill map is supplied at all", () => {
    const result = aggregateWorkbook({ Productivity: [row("Edits")] });
    const codes = new Set(result.metrics.map((m) => m.kpiCode));
    expect(codes.has("CPH")).toBe(true);
    expect(codes.has("AHT")).toBe(true);
  });

  it("still records per-skill production for PAR on a case-rate skill", () => {
    const result = aggregateWorkbook({ Productivity: [row("Fax")] }, metrics);
    expect(result.skillWeeks.length).toBe(1);
    expect(result.skillWeeks[0].cases).toBe(100);
  });
})

/**
 * Per-week org structure, the raw material for dated assignment history.
 *
 * The source repeats the supervisor on every weekly row, so a realignment is
 * already stated in the file. The aggregator used to collapse those to one
 * value per person and throw the dates away, which is what let a realignment
 * retroactively move a month of results to the new supervisor.
 */
describe("aggregateWorkbook org history", () => {
  const row = (weekly: string, supervisor: string, supEid: string) => ({
    EID: "1",
    EMPLOYEENAME: "A",
    Weekly: weekly,
    "Current Supervisor": supervisor,
    "Current Sup EID": supEid,
    "Deputy Manager": "Leou",
    Site: "Manila",
    CASESCOMPLETED: 10,
    PRODUCTIVITYHOUR: 1,
  });

  it("keeps the structure each week stated, not just the last one seen", () => {
    const result = aggregateWorkbook({
      Productivity: [
        row("WE 08/07/26", "Lea", "S1"),
        row("WE 08/14/26", "Lea", "S1"),
        row("WE 08/21/26", "Lovely", "S2"),
      ],
    });

    expect(result.orgWeeks).toHaveLength(3);
    expect(result.orgWeeks.map((w) => [w.weekStart, w.supervisorName])).toEqual([
      ["2026-08-02", "Lea"],
      ["2026-08-09", "Lea"],
      ["2026-08-16", "Lovely"],
    ]);
    // The roster row still carries the latest value, which is what drives
    // authorization and everyday work.
    expect(result.employees[0].supervisorName).toBe("Lovely");
  });

  it("does not let a sheet without org columns erase what another stated", () => {
    // Quality sheets carry no supervisor. Processing one after Productivity
    // must not blank out the structure already recorded for that week.
    const result = aggregateWorkbook({
      Productivity: [row("WE 08/07/26", "Lea", "S1")],
      Quality: [{ EID: "1", AgentName: "A", Weekly: "WE 08/07/26", Score: 1 }],
    });

    expect(result.orgWeeks).toHaveLength(1);
    expect(result.orgWeeks[0].supervisorName).toBe("Lea");
  });

  it("records nothing for a workbook that names no structure at all", () => {
    const result = aggregateWorkbook({
      Quality: [{ EID: "1", AgentName: "A", Weekly: "WE 08/07/26", Score: 1 }],
    });
    expect(result.orgWeeks).toEqual([]);
  });
});

describe("ramp target overrides", () => {
  const week = "WE 08/07/26";

  function rampMap(entries: Record<string, { cphTarget?: number; ahtTarget?: number }>) {
    return new Map(Object.entries(entries));
  }

  it("overrides the row's own target for an employee with an active ramp assignment", () => {
    const result = aggregateWorkbook(
      {
        Productivity: [
          {
            EID: "1",
            EMPLOYEENAME: "New Hire",
            SKILLTYPE: "General Phone",
            Weekly: week,
            CASESCOMPLETED: 10,
            PRODUCTIVITYHOUR: 1,
            AHTTarget: 515, // the row's own (steady) target
          },
        ],
      },
      undefined,
      rampMap({ "1|2026-08-02|generalphone": { ahtTarget: 920 } }), // Week 1 of ramp
    );

    expect(result.skillWeeks[0]).toMatchObject({ ahtTarget: 920 });
    const aht = result.metrics.find((m) => m.kpiCode === "AHT");
    expect(aht?.targetValue).toBe(920);
  });

  it("leaves an employee with no ramp assignment entirely unaffected", () => {
    const result = aggregateWorkbook(
      {
        Productivity: [
          {
            EID: "2",
            EMPLOYEENAME: "Tenured",
            SKILLTYPE: "General Phone",
            Weekly: week,
            CASESCOMPLETED: 10,
            PRODUCTIVITYHOUR: 1,
            AHTTarget: 515,
          },
        ],
      },
      undefined,
      // A ramp map with an entry for someone else's employee/week/skill key —
      // proving the lookup is scoped precisely rather than applied broadly.
      rampMap({ "1|2026-08-02|generalphone": { ahtTarget: 920 } }),
    );

    expect(result.skillWeeks[0]).toMatchObject({ ahtTarget: 515 });
  });

  it("does not apply once the row's own week has moved past the ramp map's entries", () => {
    // The ramp map only ever contains entries for weeks inside an active
    // window (built by loadRampTargets); a week with no entry must fall
    // through to the row's own target exactly as if there were no ramp map
    // at all, matching a completed ramp or a week before it started.
    const result = aggregateWorkbook(
      {
        Productivity: [
          {
            EID: "1",
            EMPLOYEENAME: "New Hire",
            SKILLTYPE: "General Phone",
            Weekly: "WE 10/02/26",
            CASESCOMPLETED: 10,
            PRODUCTIVITYHOUR: 1,
            AHTTarget: 515,
          },
        ],
      },
      undefined,
      rampMap({ "1|2026-08-02|generalphone": { ahtTarget: 920 } }),
    );

    expect(result.skillWeeks[0]).toMatchObject({ ahtTarget: 515 });
  });

  it("matches regardless of which normalized spelling the row uses", () => {
    // loadRampTargets populates one entry per alias/code/name; the row here
    // uses a different casing and spacing than the key above to prove the
    // normalization, not an exact string match, is what connects them.
    const result = aggregateWorkbook(
      {
        Productivity: [
          {
            EID: "1",
            EMPLOYEENAME: "New Hire",
            SKILLTYPE: "  General---Phone  ",
            Weekly: week,
            CASESCOMPLETED: 10,
            PRODUCTIVITYHOUR: 1,
            AHTTarget: 515,
          },
        ],
      },
      undefined,
      rampMap({ "1|2026-08-02|generalphone": { ahtTarget: 920 } }),
    );

    expect(result.skillWeeks[0]).toMatchObject({ ahtTarget: 920 });
  });
});

describe("standard errors", () => {
  const week = "WE 08/07/26";
  const standardFacts = (result: ReturnType<typeof aggregateWorkbook>) =>
    result.metricFacts.filter((f) => f.kpiCode === "STANDARD_ERRORS");

  it("reads the Standard count column alongside the critical IO label", () => {
    const result = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, "Error Date": "2026-08-03", ComplianceRisk: "Critical IO", Standard: 2 },
        { EID: "1", AgentName: "A", Weekly: week, "Error Date": "2026-08-04", ComplianceRisk: "Standard IO", Standard: 1 },
      ],
    });
    expect(standardFacts(result)).toEqual([
      { eid: "1", kpiCode: "STANDARD_ERRORS", factDate: "2026-08-03", numerator: 2, denominator: 1, sampleSize: 1 },
      { eid: "1", kpiCode: "STANDARD_ERRORS", factDate: "2026-08-04", numerator: 1, denominator: 1, sampleSize: 1 },
    ]);
    // The critical count is unchanged by the new column.
    expect(result.metrics.find((m) => m.kpiCode === "CRITICAL_ERRORS")?.actualValue).toBe(1);
  });

  it("falls back to the label when there is no Standard column, and says so", () => {
    const result = aggregateWorkbook({
      Feedback: [
        { EID: "1", AgentName: "A", Weekly: week, "Error Date": "2026-08-03", ComplianceRisk: "Critical IO" },
        { EID: "1", AgentName: "A", Weekly: week, "Error Date": "2026-08-03", ComplianceRisk: "Standard IO" },
      ],
    });
    expect(standardFacts(result)).toEqual([
      { eid: "1", kpiCode: "STANDARD_ERRORS", factDate: "2026-08-03", numerator: 1, denominator: 2, sampleSize: 2 },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", sheet: "Feedback", message: expect.stringContaining('No "Standard" column') }),
    );
  });

  it("never writes a weekly Standard Errors row — the scorecard sums the facts over its own window", () => {
    const result = aggregateWorkbook({
      Feedback: [{ EID: "1", AgentName: "A", Weekly: week, "Error Date": "2026-08-03", ComplianceRisk: "Standard IO", Standard: 3 }],
    });
    expect(result.metrics.map((m) => m.kpiCode)).toEqual(["CRITICAL_ERRORS"]);
  });
});

describe("the Monthly sheet", () => {
  it("reads one row per employee per month with a column per metric", () => {
    const result = aggregateWorkbook({
      Monthly: [
        { EID: "001919795", "Employee Name": "A", "Current Sup EID": "9", Month: "2026-09", IRE: 0, PKT: 95, "LH Utilization": 82.38 },
        // A numeric cell, as Excel keeps an all-digit EID: padded back to the stored form.
        { EID: 1919796, "Employee Name": "B", Month: "September 2026", IRE: 2, PKT: 0.9, "LH Utilization": 0.7 },
      ],
    });
    expect(result.monthlyMetrics).toEqual([
      { eid: "001919795", month: "2026-09-01", metric: "IRE", value: 0 },
      { eid: "001919795", month: "2026-09-01", metric: "PKT", value: 95 },
      { eid: "001919795", month: "2026-09-01", metric: "LH_UTILIZATION", value: 82.38 },
      { eid: "001919796", month: "2026-09-01", metric: "IRE", value: 2 },
      { eid: "001919796", month: "2026-09-01", metric: "PKT", value: 90 },
      { eid: "001919796", month: "2026-09-01", metric: "LH_UTILIZATION", value: 70 },
    ]);
    expect(result.sheets).toContainEqual({ sheet: "Monthly", rowsRead: 2, rowsUsed: 2, rowsSkipped: 0 });
    expect(result.unrecognizedSheets).toEqual([]);
    expect(result.employees.map((e) => e.eid)).toEqual(["001919795", "001919796"]);
  });

  it("reads the long shape too — one row per metric", () => {
    const result = aggregateWorkbook({
      "Monthly Metrics": [
        { EID: "001919795", "Employee Name": "A", Month: "09/2026", Metric: "IRE", Value: 1 },
        { EID: "001919795", "Employee Name": "A", Month: "09/2026", Metric: "LH Utilisation", Value: 71.42 },
        { EID: "001919795", "Employee Name": "A", Month: "09/2026", Metric: "Attendance", Value: 100 },
      ],
    });
    expect(result.monthlyMetrics).toEqual([
      { eid: "001919795", month: "2026-09-01", metric: "IRE", value: 1 },
      { eid: "001919795", month: "2026-09-01", metric: "LH_UTILIZATION", value: 71.42 },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ sheet: "Monthly Metrics", message: expect.stringContaining("no IRE, PKT or LH"), count: 1 }),
    );
  });

  it("is optional on a weekly upload, and never touches the week list", () => {
    const weekly = aggregateWorkbook({
      Feedback: [{ EID: "1", AgentName: "A", Weekly: "WE 08/07/26", ComplianceRisk: "Critical IO" }],
    });
    expect(weekly.monthlyMetrics).toEqual([]);
    expect(weekly.issues.map((i) => i.sheet)).not.toContain("monthly");

    const monthlyOnly = aggregateWorkbook({ Monthly: [{ EID: "001919795", Month: "2026-09", IRE: 0 }] });
    expect(monthlyOnly.weeks).toEqual([]);
  });

  it("reports rows it cannot place", () => {
    const result = aggregateWorkbook({
      Monthly: [
        { EID: "", Month: "2026-09", IRE: 0 },
        { EID: "001919795", Month: "Q3", IRE: 0 },
        { EID: "001919795", Month: "2026-09", Notes: "x" },
      ],
    });
    expect(result.monthlyMetrics).toEqual([]);
    expect(result.sheets).toContainEqual({ sheet: "Monthly", rowsRead: 3, rowsUsed: 0, rowsSkipped: 3 });
    expect(result.issues.filter((i) => i.sheet === "Monthly").map((i) => i.count)).toEqual([1, 1, 1]);
  });
});
