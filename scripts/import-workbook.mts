/**
 * Imports a workbook from the command line.
 *
 *   npm run import -- "/path/to/RawData.xlsx"
 *
 * Exists so an import can be run and inspected without the admin UI, and so
 * the same pipeline the UI uses can be exercised against a real file.
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db/client";
import { importBatches } from "../src/lib/db/schema";
import { commitImport } from "../src/lib/import-pipeline/commit";
import { parseWorkbookBuffer } from "../src/lib/import-pipeline/parse-workbook";
import { loadRampTargets, loadSkillMetrics } from "../src/lib/import-pipeline/par-scoring";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run import -- <path-to-workbook>");
  process.exit(1);
}

const buffer = readFileSync(filePath);
// Matches src/app/(shell)/import/actions.ts exactly, so a command-line run
// exercises the identical pipeline the admin UI does — including ramp
// targets, which this script previously left out.
const [skillMetrics, rampTargets] = await Promise.all([loadSkillMetrics(), loadRampTargets()]);
const parsed = parseWorkbookBuffer(buffer, skillMetrics, rampTargets);

console.log("--- parse ---");
console.log("weeks:", parsed.weeks.join(", "));
console.log("employees:", parsed.employees.length);
console.log("metrics:", parsed.metrics.length);
for (const sheet of parsed.sheets) {
  console.log(`  ${sheet.sheet}: read ${sheet.rowsRead}, used ${sheet.rowsUsed}, skipped ${sheet.rowsSkipped}`);
}
if (parsed.unrecognizedSheets.length) {
  console.log("ignored sheets:", parsed.unrecognizedSheets.join(", "));
}
for (const issue of parsed.issues) {
  console.log(`  [${issue.severity}] ${issue.sheet}: ${issue.message}${issue.count ? ` (${issue.count} rows)` : ""}`);
}

const [batch] = await db
  .insert(importBatches)
  .values({ fileName: filePath.split("/").pop() ?? "workbook", status: "validated" })
  .returning();

console.log("\n--- commit ---");
const summary = await commitImport(parsed, { importBatchId: batch.id });
console.log(JSON.stringify(summary, null, 2));

process.exit(0);
