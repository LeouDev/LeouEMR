import * as XLSX from "xlsx";

/**
 * The blank monthly masterlist workbook handed to administrators.
 *
 * Column names here are the ones parseMasterlistBuffer's resolver accepts —
 * mirrors template.ts's own pairing with the weekly parser, so the two stay
 * in sync deliberately rather than by accident.
 */
export const MASTERLIST_COLUMNS: Array<[header: string, example: string]> = [
  ["Agent EID", "001895123"],
  ["Agent Name", "Dela Cruz, Juan"],
  ["Supervisor Name", "Santos, Maria"],
  ["Supervisor EID", "001772004"],
  ["Manager Name", "Reyes, Ana"],
  ["Site", "Manila"],
];

const README: string[][] = [
  ["OptumRX EMR — monthly masterlist upload template"],
  [],
  ["How to use"],
  ["1. Fill one row per active agent below the header row. Do not rename the sheet or the headers."],
  ["2. This file must be the complete roster for the month — every agent who should still be active."],
  ["3. An agent who was active last month and is missing from this file is treated as attrited: their"],
  ["   assignment is closed as of the day before this month starts."],
  ["4. Upload on the Import page. You see a preview — including who this would mark as attrited —"],
  ["   before anything is committed."],
  ["5. Delete the example row before uploading."],
  [],
  ["Rules the importer applies"],
  ["Agent EID and Supervisor EID must be exactly 9 digits, including leading zeros. Format those"],
  ["columns as Text so Excel keeps them."],
  ["A duplicate Agent EID in the file keeps only the first occurrence; the rest are reported."],
  ["An Agent EID that matches no known employee is reported and skipped, not created."],
];

export function buildMasterlistTemplateWorkbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();

  const readme = XLSX.utils.aoa_to_sheet(README);
  readme["!cols"] = [{ wch: 92 }];
  XLSX.utils.book_append_sheet(book, readme, "Read me");

  const sheet = XLSX.utils.aoa_to_sheet([
    MASTERLIST_COLUMNS.map(([header]) => header),
    MASTERLIST_COLUMNS.map(([, example]) => example),
  ]);
  sheet["!cols"] = MASTERLIST_COLUMNS.map(([header]) => ({ wch: Math.max(header.length + 4, 14) }));
  XLSX.utils.book_append_sheet(book, sheet, "Masterlist");

  return book;
}
