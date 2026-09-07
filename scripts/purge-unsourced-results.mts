/**
 * Removes performance rows that no import ever produced.
 *
 * Every legitimate weekly result and daily fact carries the id of the import
 * batch that wrote it. Rows without one were inserted straight into the
 * database, so they are not data — they are somebody's test fixture, and they
 * are indistinguishable from real results everywhere the app reads them.
 *
 * That matters beyond the numbers on a dashboard: the action-item engine
 * advances an issue on consecutive passing weeks, so fabricated passing weeks
 * can close a real performance issue. Re-run the engine afterwards.
 *
 * Purge first, then re-evaluate. Run in the other order and the engine simply
 * re-derives the same state from the rows still sitting there.
 *
 *   npm run purge:unsourced            # report only
 *   npm run purge:unsourced -- --apply # delete, in one transaction
 *   npm run reevaluate                 # then rebuild the issues (no flag; always applies)
 */
import { isNull } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  employees,
  kpiDefinitions,
  metricFacts,
  weeklyMetricResults,
} from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const apply = process.argv.includes("--apply");
// Printed so a run that quietly stayed a dry run is obvious in the output
// rather than looking like a purge that found nothing to do.
console.log(`mode: ${apply ? "APPLY (will delete)" : "dry run"}  argv: ${process.argv.slice(2).join(" ") || "(none)"}`);

const weekly = await db
  .select({
    id: weeklyMetricResults.id,
    eid: employees.eid,
    name: employees.name,
    week: weeklyMetricResults.weekStart,
    kpi: kpiDefinitions.code,
    value: weeklyMetricResults.actualValue,
    status: weeklyMetricResults.status,
  })
  .from(weeklyMetricResults)
  .innerJoin(employees, eq(employees.id, weeklyMetricResults.employeeId))
  .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
  .where(isNull(weeklyMetricResults.sourceImportId));

const facts = await db
  .select({
    id: metricFacts.id,
    eid: employees.eid,
    date: metricFacts.factDate,
    kpi: kpiDefinitions.code,
  })
  .from(metricFacts)
  .innerJoin(employees, eq(employees.id, metricFacts.employeeId))
  .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, metricFacts.kpiId))
  .where(isNull(metricFacts.sourceImportId));

console.log(`weekly_metric_results with no source import: ${weekly.length}`);
console.table(weekly.map(({ id, ...rest }) => rest));
console.log(`metric_facts with no source import: ${facts.length}`);
console.table(facts.map(({ id, ...rest }) => rest));

const affected = [...new Set(weekly.map((r) => `${r.name} (${r.eid})`))];
console.log(`\nemployees affected: ${affected.join(", ") || "none"}`);

if (weekly.length === 0 && facts.length === 0) {
  console.log("Nothing to purge.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete these rows.");
  process.exit(0);
}

// One transaction: a half-purge would leave weekly results with no facts
// behind them, which reads as a genuine result that cannot be re-derived.
await db.transaction(async (tx) => {
  await tx.delete(weeklyMetricResults).where(isNull(weeklyMetricResults.sourceImportId));
  await tx.delete(metricFacts).where(isNull(metricFacts.sourceImportId));
});

console.log(`\nDeleted ${weekly.length} weekly results and ${facts.length} daily facts.`);
console.log("Now re-run the action-item engine: npm run reevaluate");
process.exit(0);
