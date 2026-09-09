import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseMasterlistBuffer } from "./masterlist";

function bufferFromRows(headers: string[], rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(book, sheet, "Masterlist");
  return XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

const HEADERS = ["Agent EID", "Agent Name", "Supervisor Name", "Supervisor EID", "Manager Name", "Site"];

describe("parseMasterlistBuffer", () => {
  it("parses a well-formed row", () => {
    const buffer = bufferFromRows(HEADERS, [
      ["001895123", "Juan Dela Cruz", "Maria Santos", "001772004", "Ana Reyes", "Manila"],
    ]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      {
        agentEid: "001895123",
        agentName: "Juan Dela Cruz",
        supervisorName: "Maria Santos",
        supervisorEid: "001772004",
        managerName: "Ana Reyes",
        site: "Manila",
      },
    ]);
  });

  it("pads a short EID that Excel read as a number, dropping the leading zero", () => {
    const buffer = bufferFromRows(HEADERS, [[1895123, "Juan Dela Cruz", "Maria Santos", "", "Ana Reyes", "Manila"]]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows[0].agentEid).toBe("001895123");
  });

  it("skips and reports a row with no EID", () => {
    const buffer = bufferFromRows(HEADERS, [
      ["", "No EID Here", "Maria Santos", "", "Ana Reyes", "Manila"],
      ["001895123", "Juan Dela Cruz", "Maria Santos", "", "Ana Reyes", "Manila"],
    ]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.issues).toContainEqual({
      severity: "error",
      sheet: "Masterlist",
      message: "Row has no Agent EID",
      count: 1,
    });
  });

  it("skips and reports a row whose EID isn't 9 digits, even after padding", () => {
    const buffer = bufferFromRows(HEADERS, [["1234567890", "Bad EID", "Maria Santos", "", "Ana Reyes", "Manila"]]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.issues).toContainEqual({
      severity: "error",
      sheet: "Masterlist",
      message: "Agent EID is not 9 digits",
      count: 1,
    });
  });

  it("keeps the first occurrence of a duplicate EID and reports the rest", () => {
    const buffer = bufferFromRows(HEADERS, [
      ["001895123", "First", "Maria Santos", "", "Ana Reyes", "Manila"],
      ["001895123", "Second", "Different Supervisor", "", "Ana Reyes", "Manila"],
    ]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].agentName).toBe("First");
    expect(result.issues).toContainEqual({
      severity: "error",
      sheet: "Masterlist",
      message: "Duplicate Agent EID in this file — only the first occurrence was kept",
      count: 1,
    });
  });

  it("warns, but still includes, a row with no supervisor, manager, or site at all", () => {
    const buffer = bufferFromRows(HEADERS, [["001895123", "Juan Dela Cruz", "", "", "", ""]]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.issues).toContainEqual({
      severity: "warning",
      sheet: "Masterlist",
      message: "Row has no Supervisor, Manager, or Site at all",
      count: 1,
    });
  });

  it("skips a 'Read me' sheet and reads the first other sheet instead", () => {
    const book = XLSX.utils.book_new();
    const readme = XLSX.utils.aoa_to_sheet([["Instructions"], ["Fill this out"]]);
    XLSX.utils.book_append_sheet(book, readme, "Read me");
    const data = XLSX.utils.aoa_to_sheet([HEADERS, ["001895123", "Juan Dela Cruz", "Maria Santos", "", "Ana Reyes", "Manila"]]);
    XLSX.utils.book_append_sheet(book, data, "Masterlist");
    const buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;

    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].agentEid).toBe("001895123");
  });

  it("tolerates header variants via the shared column resolver", () => {
    const buffer = bufferFromRows(
      ["EID", "Employee Name", "Current Supervisor", "Sup EID", "Deputy Manager", "SiteLocation"],
      [["001895123", "Juan Dela Cruz", "Maria Santos", "001772004", "Ana Reyes", "Manila"]],
    );
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toEqual([
      {
        agentEid: "001895123",
        agentName: "Juan Dela Cruz",
        supervisorName: "Maria Santos",
        supervisorEid: "001772004",
        managerName: "Ana Reyes",
        site: "Manila",
      },
    ]);
  });

  it("errors when there's no recognizable Agent EID column", () => {
    const buffer = bufferFromRows(["Foo", "Bar"], [["x", "y"]]);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toEqual([]);
    expect(result.issues[0].severity).toBe("error");
  });

  it("returns empty, no issues, for a sheet with headers but no data rows", () => {
    const buffer = bufferFromRows(HEADERS, []);
    const result = parseMasterlistBuffer(buffer);
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});
