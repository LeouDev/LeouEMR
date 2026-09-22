import { describe, expect, it } from "vitest";
import { csvOf } from "@/lib/csv";
import { deriveAutoIndicators, EMPTY_AUTO_METRICS } from "./auto-indicators";
import {
  ewsRosterExportFilename,
  ewsRosterExportHeader,
  ewsRosterExportRows,
  LEAVE_REGISTER_EXPORT_HEADER,
  leaveRegisterExportFilename,
  leaveRegisterExportRows,
  returnOverdue,
} from "./export";
import { buildRosterRow } from "./roster";

const indicators = [
  { code: "tardy", label: "Frequent tardiness" },
  { code: "absent", label: "Increased absences" },
  { code: "jobhunt", label: "Job hunting signals" },
];

const row = buildRosterRow({
  employeeId: "e1",
  eid: "900292132",
  name: "Alba, Dorellyn",
  position: "Pharmacy Technician",
  supervisorEid: "001772004",
  supervisorName: "Herbias",
  latest: {
    week: "2026-09-13",
    indicators: { jobhunt: true },
    capActive: true,
    attrition: "loa",
    attritionDate: "2026-09-01",
    expectedReturn: "2026-10-01",
    actionPlan: "SKIP_LEVEL",
    notes: "Family emergency",
    score: 2,
    updatedAt: "2026-09-19T08:00:00Z",
    assessedByName: "Herbias",
  },
  previousScore: 1,
  auto: deriveAutoIndicators({ ...EMPTY_AUTO_METRICS, attendance: 80 }),
});

describe("ewsRosterExportRows", () => {
  it("writes the table's columns then a YES/NO per indicator, derived ones from the data", () => {
    const header = ewsRosterExportHeader(indicators);
    const [line] = ewsRosterExportRows([row], indicators);
    expect(line).toEqual([
      "Herbias", "Alba, Dorellyn", "900292132", "Pharmacy Technician", "At risk", 3, "+2", "YES",
      "For SKIP Level", "Leave of absence", "2026-09-01", "2026-10-01", "2026-09-13", "Herbias", "Family emergency",
      "NO", "YES", "YES",
    ]);
    expect(line).toHaveLength(header.length);
    expect(header.slice(-3)).toEqual(["Frequent tardiness", "Increased absences", "Job hunting signals"]);
  });

  it("leaves what is not there blank and opens as a CSV", () => {
    const bare = buildRosterRow({ ...row, latest: null, previousScore: null, position: null, supervisorName: null });
    const [line] = ewsRosterExportRows([bare], indicators);
    expect(line.slice(0, 7)).toEqual(["", "Alba, Dorellyn", "900292132", "", "Watch", 1, ""]);
    const csv = csvOf([ewsRosterExportHeader(indicators), line]);
    expect(csv.split("\r\n")[0]).toContain('"Team leader","Employee","EID"');
  });

  it("names the file by the day and the team", () => {
    expect(ewsRosterExportFilename("2026-09-22", null)).toBe("ews-roster-2026-09-22");
    expect(ewsRosterExportFilename("2026-09-22", "001772004")).toBe("ews-roster-001772004-2026-09-22");
  });
});

describe("leave register export", () => {
  const rows = [
    { supervisorName: "Herbias", name: "Dizon, Ronald", eid: "1", attrition: "loa" as const, started: "2026-08-15", expectedReturn: "2026-10-01", notes: null },
    { supervisorName: null, name: "Fernandez, Liza", eid: "2", attrition: "maternity" as const, started: "2026-05-01", expectedReturn: "2026-09-15", notes: "Back part-time" },
    { supervisorName: "Cruz", name: "Salazar, Jerome", eid: "3", attrition: "absconding" as const, started: "2026-09-10", expectedReturn: null, notes: null },
  ];

  it("flags a return that has passed", () => {
    const out = leaveRegisterExportRows(rows, "2026-09-22");
    expect(out.map((r) => r[6])).toEqual(["On leave", "Return overdue", "On leave"]);
    expect(out[1]).toEqual(["", "Fernandez, Liza", "2", "Maternity", "2026-05-01", "2026-09-15", "Return overdue", "Back part-time"]);
    expect(out[2][3]).toBe("Absconding");
    for (const line of out) expect(line).toHaveLength(LEAVE_REGISTER_EXPORT_HEADER.length);
    expect(returnOverdue({ expectedReturn: "2026-09-22" }, "2026-09-22")).toBe(false);
  });

  it("names the file by the day", () => {
    expect(leaveRegisterExportFilename("2026-09-22")).toBe("ews-leave-register-2026-09-22");
  });
});
