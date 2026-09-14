import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { MONTHLY_SHEET_ALIASES, SHEET_ALIASES, aggregateWorkbook } from "./aggregate";
import { IDENTITY_COLUMNS, parseMonthLabel, parseWeekLabel } from "./columns";
import { TEMPLATE_IDENTITY, TEMPLATE_MONTHLY, TEMPLATE_SHEETS, buildTemplateWorkbook } from "./template";

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

    expect(parsed.SheetNames).toEqual([
      "Read me",
      ...TEMPLATE_SHEETS.map((s) => s.name),
      TEMPLATE_MONTHLY.name,
    ]);

    for (const sheet of TEMPLATE_SHEETS) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets[sheet.name]);
      expect(rows, sheet.name).toHaveLength(1);

      const expected = [...TEMPLATE_IDENTITY, ...sheet.extra].map(([h]) => h);
      expect(Object.keys(rows[0]), sheet.name).toEqual(expected);
    }
  });
});

describe("upload template — the monthly sheet", () => {
  it("is named so the importer finds it", () => {
    expect(MONTHLY_SHEET_ALIASES).toContain(TEMPLATE_MONTHLY.name.trim().toLowerCase());
  });

  it("writes an example month the parser can read", () => {
    const [, example] = TEMPLATE_MONTHLY.columns.find(([h]) => h === "Month")!;
    expect(parseMonthLabel(example)).toBe("2026-09-01");
  });

  it("round-trips its example row into three monthly figures", () => {
    const parsed = XLSX.read(XLSX.write(buildTemplateWorkbook(), { bookType: "xlsx", type: "buffer" }));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets[TEMPLATE_MONTHLY.name]);
    const result = aggregateWorkbook({ [TEMPLATE_MONTHLY.name]: rows });
    expect(result.monthlyMetrics).toEqual([
      { eid: "001895123", month: "2026-09-01", metric: "IRE", value: 0 },
      { eid: "001895123", month: "2026-09-01", metric: "PKT", value: 95 },
      { eid: "001895123", month: "2026-09-01", metric: "LH_UTILIZATION", value: 82.38 },
    ]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", sheet: "productivity" }),
    ]));
  });
});
