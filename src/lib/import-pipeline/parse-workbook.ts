import * as XLSX from "xlsx";
import { aggregateWorkbook, type SheetRows, type SkillMetrics } from "./aggregate";
import type { ParseResult } from "./types";

/**
 * Reads an uploaded .xlsx/.xls/.csv buffer into per-sheet row objects and
 * aggregates it. Parsing and aggregation are kept separate so the
 * aggregation rules stay testable without a real workbook.
 */
export function parseWorkbookBuffer(
  buffer: ArrayBuffer | Buffer,
  skillMetrics?: SkillMetrics,
): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheets: SheetRows = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
  }

  return aggregateWorkbook(sheets, skillMetrics);
}
