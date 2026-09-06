import * as XLSX from "xlsx";

/**
 * The blank upload workbook handed to administrators.
 *
 * Column names here are the ones the importer's resolver accepts, so the
 * template and the parser describe the same contract; template.test.ts
 * asserts that, which is what keeps them from drifting apart.
 */

/** Columns every sheet needs to identify the person and the reporting week. */
export const TEMPLATE_IDENTITY: Array<[header: string, example: string]> = [
  ["EID", "001895123"],
  ["Employee Name", "Dela Cruz, Juan"],
  ["Current Supervisor", "Santos, Maria"],
  ["Current Sup EID", "001772004"],
  ["Deputy Manager", "Reyes, Ana"],
  ["Site", "Manila"],
  ["SkillType", "Fax"],
  ["Weekly", "WE 08/28/26"],
];

export const TEMPLATE_SHEETS: Array<{
  /** Sheet name as written in the workbook. */
  name: string;
  /** The key this sheet must match in the importer's SHEET_ALIASES. */
  canonical: string;
  note: string;
  extra: Array<[header: string, example: string]>;
}> = [
  {
    name: "Productivity",
    canonical: "productivity",
    note: "One row per employee per day per skill. Cases and hours drive PAR/MBO.",
    extra: [
      ["Date Completed", "2026-08-24"],
      ["Cases Completed", "42"],
      ["Productivity Hour", "7.5"],
      ["IEX Prod Hours", "8"],
      ["Prod Weight", "38.5"],
      ["CPH Target", "5.6"],
      ["AHT Target", "643"],
    ],
  },
  {
    name: "Quality",
    canonical: "quality",
    note:
      "One row per audit. Score is a fraction of 1, not a percentage — 0.98 for a 98% audit " +
      "and 1 for a perfect one. Anything below 1 counts as an imperfect audit for DPU. " +
      "TotalMarkdown is the markdown count on that audit.",
    extra: [
      ["Date", "2026-08-24"],
      ["Score", "0.98"],
      ["TotalMarkdown", "1"],
    ],
  },
  {
    name: "NPS",
    canonical: "nps",
    note:
      "One row per survey response, scored the way the source system encodes it: " +
      "100 for a promoter, 0 for a passive and -100 for a detractor. The NPS is the mean " +
      "of those, so a survey percentage such as 80 must not be entered here.",
    extra: [
      ["Date", "2026-08-24"],
      ["NPS", "100"],
    ],
  },
  {
    name: "Attendance",
    canonical: "attendance",
    note: "One row per employee per day. PRESENT/ABSENT are 1 or 0.",
    extra: [
      ["Date", "2026-08-24"],
      ["PRESENT", "1"],
      ["ABSENT", "0"],
      ["STATUS", "Present"],
    ],
  },
  {
    name: "Feedback",
    canonical: "feedback",
    note: "One row per compliance finding. A Compliance Risk of Critical counts as a severe finding.",
    extra: [
      ["Error Date", "2026-08-24"],
      ["Compliance Risk", "Critical"],
    ],
  },
];

const README: string[][] = [
  ["OptumRX EMR — performance data upload template"],
  [],
  ["How to use"],
  ["1. Fill each sheet below the header row. Do not rename the sheets or the headers."],
  ["2. Leave a sheet empty if you have no data for it that week — it is skipped, not failed."],
  ["3. Upload on the Import page. You see a preview before anything is committed."],
  ["4. Delete the example row before uploading."],
  [],
  ["Rules the importer applies"],
  ["EID must be exactly 9 digits, including leading zeros. Format the column as Text so Excel keeps them."],
  ['Weekly is the week-ending Friday, written as "WE MM/DD/YY".'],
  ["Re-uploading a week replaces that week's computed values and leaves earlier weeks untouched."],
  ["Rows without a recognisable EID or week label are reported in the preview and skipped."],
  [],
  ["Sheets"],
  ...TEMPLATE_SHEETS.map((sheet) => [sheet.name, sheet.note]),
];

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();

  const readme = XLSX.utils.aoa_to_sheet(README);
  readme["!cols"] = [{ wch: 46 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(book, readme, "Read me");

  for (const { name, extra } of TEMPLATE_SHEETS) {
    const columns = [...TEMPLATE_IDENTITY, ...extra];
    const sheet = XLSX.utils.aoa_to_sheet([
      columns.map(([header]) => header),
      columns.map(([, example]) => example),
    ]);
    sheet["!cols"] = columns.map(([header]) => ({ wch: Math.max(header.length + 4, 14) }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  }

  return book;
}
