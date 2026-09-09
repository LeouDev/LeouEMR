import { describe, expect, it } from "vitest";
import { planMasterlistCommit, resolveMasterlistMonth } from "./masterlist-commit";
import type { ParsedMasterlistRow } from "./masterlist";

const MONTH_START = "2026-08-01";
const MONTH_END = "2026-08-31";
const IMPORT_BATCH_ID = "batch-1";

function row(overrides: Partial<ParsedMasterlistRow> & { agentEid: string }): ParsedMasterlistRow {
  return {
    agentEid: overrides.agentEid,
    agentName: overrides.agentName ?? "Some Agent",
    supervisorName: overrides.supervisorName ?? "Maria Santos",
    supervisorEid: overrides.supervisorEid ?? "001772004",
    managerName: overrides.managerName ?? "Ana Reyes",
    site: overrides.site ?? "Manila",
  };
}

describe("resolveMasterlistMonth", () => {
  it("resolves the calendar month containing the given date", () => {
    const { start, end } = resolveMasterlistMonth("2026-08-15");
    expect(start).toBe("2026-08-01");
    expect(end).toBe("2026-08-31");
  });
});

describe("planMasterlistCommit", () => {
  it("opens a new open-ended assignment for an employee with no prior history", () => {
    const rows = [row({ agentEid: "001895123" })];
    const plan = planMasterlistCommit(
      rows,
      MONTH_START,
      MONTH_END,
      [{ id: "emp-1", eid: "001895123" }],
      [],
      [],
      IMPORT_BATCH_ID,
    );

    expect(plan.employeeIdsToReplace).toEqual(["emp-1"]);
    expect(plan.values).toEqual([
      {
        employeeId: "emp-1",
        effectiveFrom: MONTH_START,
        effectiveTo: null,
        supervisorEid: "001772004",
        supervisorName: "Maria Santos",
        managerName: "Ana Reyes",
        site: "Manila",
        sourceImportId: IMPORT_BATCH_ID,
      },
    ]);
    expect(plan.agentsWritten).toBe(1);
    expect(plan.unknownEids).toEqual([]);
  });

  it("leaves history before the month untouched and adds an open interval for the month", () => {
    const rows = [row({ agentEid: "001895123", supervisorName: "New Supervisor" })];
    const existing = [
      {
        employeeId: "emp-1",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-07-31",
        supervisorEid: "000111222",
        supervisorName: "Old Supervisor",
        managerName: "Old Manager",
        site: "Manila",
      },
    ];
    const plan = planMasterlistCommit(
      rows,
      MONTH_START,
      MONTH_END,
      [{ id: "emp-1", eid: "001895123" }],
      existing,
      [],
      IMPORT_BATCH_ID,
    );

    expect(plan.values).toHaveLength(2);
    const [older, newer] = plan.values.sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1));
    expect(older).toMatchObject({ effectiveFrom: "2026-01-01", effectiveTo: "2026-07-31", supervisorName: "Old Supervisor" });
    expect(newer).toMatchObject({ effectiveFrom: MONTH_START, effectiveTo: null, supervisorName: "New Supervisor" });
  });

  it("merges into the prior interval instead of duplicating it when the org tuple hasn't changed", () => {
    const rows = [row({ agentEid: "001895123" })];
    const existing = [
      {
        employeeId: "emp-1",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-07-31",
        supervisorEid: "001772004",
        supervisorName: "Maria Santos",
        managerName: "Ana Reyes",
        site: "Manila",
      },
    ];
    const plan = planMasterlistCommit(
      rows,
      MONTH_START,
      MONTH_END,
      [{ id: "emp-1", eid: "001895123" }],
      existing,
      [],
      IMPORT_BATCH_ID,
    );

    expect(plan.values).toHaveLength(1);
    expect(plan.values[0]).toMatchObject({ effectiveFrom: "2026-01-01", effectiveTo: null });
  });

  it("flags an EID in the file that matches no known employee, without writing or closing anything for it", () => {
    const rows = [row({ agentEid: "999999999" })];
    const plan = planMasterlistCommit(rows, MONTH_START, MONTH_END, [], [], [], IMPORT_BATCH_ID);

    expect(plan.unknownEids).toEqual(["999999999"]);
    expect(plan.values).toEqual([]);
    expect(plan.employeeIdsToReplace).toEqual([]);
    expect(plan.agentsWritten).toBe(0);
  });

  it("closes out an employee who was active but is missing from the file, as of the day before the month", () => {
    const rows: ParsedMasterlistRow[] = [];
    const activeBefore = [{ id: "emp-2", eid: "001111111", name: "Departed Agent" }];
    const plan = planMasterlistCommit(rows, MONTH_START, MONTH_END, [], [], activeBefore, IMPORT_BATCH_ID);

    expect(plan.employeeIdsToClose).toEqual(["emp-2"]);
    expect(plan.closedBefore).toBe("2026-07-31");
    expect(plan.attritedClosed).toEqual([{ eid: "001111111", name: "Departed Agent" }]);
  });

  it("does not treat an employee present in both the file and the active roster as attrited", () => {
    const rows = [row({ agentEid: "001111111" })];
    const activeBefore = [{ id: "emp-2", eid: "001111111", name: "Still Here" }];
    const plan = planMasterlistCommit(
      rows,
      MONTH_START,
      MONTH_END,
      [{ id: "emp-2", eid: "001111111" }],
      [],
      activeBefore,
      IMPORT_BATCH_ID,
    );

    expect(plan.employeeIdsToClose).toEqual([]);
    expect(plan.attritedClosed).toEqual([]);
  });

  it("stamps every written interval with the given import batch id as its source", () => {
    const rows = [row({ agentEid: "001895123" }), row({ agentEid: "001111111" })];
    const plan = planMasterlistCommit(
      rows,
      MONTH_START,
      MONTH_END,
      [
        { id: "emp-1", eid: "001895123" },
        { id: "emp-2", eid: "001111111" },
      ],
      [],
      [],
      IMPORT_BATCH_ID,
    );

    expect(plan.values.every((v) => v.sourceImportId === IMPORT_BATCH_ID)).toBe(true);
  });
});
