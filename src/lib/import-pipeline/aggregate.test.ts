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
    expect(result.weeks).toEqual(["2026-08-01", "2026-08-08"]);
    expect(result.employees.map((e) => e.eid).sort()).toEqual(["1", "2"]);
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
      supervisorEid: "900",
      supervisorName: "Sup One",
      managerName: "Mgr One",
      site: "CEBU",
    });
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
