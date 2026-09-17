/**
 * Plain CSV: every cell quoted, CRLF rows. A text cell that starts with a
 * character Excel reads as a formula gets a leading space, so a remark, a
 * case number or a line of typed feedback beginning "=..." or "-..." stays
 * text instead of becoming a formula in whoever's spreadsheet opens it.
 *
 * Neutral module: the quality exports and the survey export both write
 * through this, and the guard above is the reason it is not reimplemented
 * per caller. `CSV_BOM` sits beside it in ./csv-bom.
 */
export function csvOf(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    const text = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? ` ${value}` : String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
