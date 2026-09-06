import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { SHEET_ALIASES } from "./aggregate";
import { IDENTITY_COLUMNS, parseWeekLabel } from "./columns";
import { TEMPLATE_IDENTITY, TEMPLATE_SHEETS, buildTemplateWorkbook } from "./template";

/**
 * The template exists to tell an administrator exactly what to fill in, so
 * its value depends entirely on the importer accepting what it produces.
 * These tests assert that contract rather than the file's appearance.
 */
describe("upload template", () => {
  const book = buildTemplateWorkbook();

  it("has a sheet for every source the importer reads", () => {
    const canonical = TEMPLATE_SHEETS.map((s) => s.canonical).sort();
    expect(canonical).toEqual(Object.keys(SHEET_ALIASES).sort());
  });

  it("names each sheet so the importer's case-insensitive match finds it", () => {
    for (const sheet of TEMPLATE_SHEETS) {
      const aliases = SHEET_ALIASES[sheet.canonical];
      expect(aliases).toBeDefined();
      expect(aliases).toContain(sheet.name.trim().toLowerCase());
    }
  });

  it("uses identity headers the column resolver recognises", () => {
    const accepted = new Set(Object.values(IDENTITY_COLUMNS).flat());
    for (const [header] of TEMPLATE_IDENTITY) {
      expect(accepted, `identity header ${header}`).toContain(header);
    }
  });

  it("carries EID and week on every data sheet, since rows are skipped without them", () => {
    const headers = TEMPLATE_IDENTITY.map(([h]) => h);
    expect(headers).toContain("EID");
    expect(headers).toContain("Weekly");
  });

  it("writes an example week label the parser can read", () => {
    const [, example] = TEMPLATE_IDENTITY.find(([h]) => h === "Weekly")!;
    expect(parseWeekLabel(example)).toEqual({
      weekStart: "2026-08-22",
      weekEnd: "2026-08-28",
    });
  });

  it("writes a 9-digit example EID, matching the sign-up rule", () => {
    const [, example] = TEMPLATE_IDENTITY.find(([h]) => h === "EID")!;
    expect(example).toMatch(/^\d{9}$/);
  });

  it("round-trips through a real workbook with one example row per sheet", () => {
    const parsed = XLSX.read(XLSX.write(book, { bookType: "xlsx", type: "buffer" }));

    expect(parsed.SheetNames).toEqual(["Read me", ...TEMPLATE_SHEETS.map((s) => s.name)]);

    for (const sheet of TEMPLATE_SHEETS) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets[sheet.name]);
      expect(rows, sheet.name).toHaveLength(1);

      const expected = [...TEMPLATE_IDENTITY, ...sheet.extra].map(([h]) => h);
      expect(Object.keys(rows[0]), sheet.name).toEqual(expected);
    }
  });
});
