import { describe, expect, it } from "vitest";
import { csvOf } from "@/lib/csv";
import { ACTION_ITEMS_EXPORT_HEADER, actionItemsExportFilename, actionItemsExportRows } from "./export";

const item = {
  actionItemId: "ai-1",
  actionItemCode: "AI-0042",
  issueCode: "PI-0042",
  status: "MONITORING",
  consecutivePassingWeeks: 2,
  openedWeek: "2026-09-06",
  employeeId: "e1",
  employeeName: "Alba,Dorellyn",
  supervisorName: "Archiene Ross Calderon Herbias",
  managerName: "Comendador",
  site: "DAVAO",
  kpiName: "Critical Errors",
  kpiCode: "CRITICAL_ERRORS",
  hasRca: true,
  hasActionPlan: false,
  coachingRequired: false,
  trainingRequired: false,
};

describe("actionItemsExportRows", () => {
  it("writes one row per item with the page's columns and the plan flags", () => {
    const [row] = actionItemsExportRows([item]);
    expect(row).toEqual([
      "AI-0042", "Alba,Dorellyn", "Archiene Ross Calderon Herbias", "Comendador", "DAVAO",
      "Critical Errors", "Monitoring", 2, "2026-09-06", "Yes", "No", "No", "No",
    ]);
    expect(row).toHaveLength(ACTION_ITEMS_EXPORT_HEADER.length);
  });

  it("leaves an unknown team, manager or site blank rather than writing null", () => {
    const [row] = actionItemsExportRows([{ ...item, supervisorName: null, managerName: null, site: null }]);
    expect(row.slice(2, 5)).toEqual(["", "", ""]);
  });

  it("produces a CSV a spreadsheet opens with a header row", () => {
    const csv = csvOf([[...ACTION_ITEMS_EXPORT_HEADER], ...actionItemsExportRows([item])]);
    expect(csv.split("\r\n")[0]).toContain('"Item","Employee","Team leader"');
    expect(csv).toContain('"AI-0042","Alba,Dorellyn"');
  });

  it("names the file by what it holds", () => {
    expect(actionItemsExportFilename("2026-09-22", true)).toBe("action-items-active-2026-09-22");
    expect(actionItemsExportFilename("2026-09-22", false)).toBe("action-items-all-2026-09-22");
  });
});
