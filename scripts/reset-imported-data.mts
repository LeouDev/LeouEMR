/**
 * Clears every trace of imported performance data, ready for a fresh upload.
 *
 * Deletes what the import pipeline wrote and everything derived from it: the
 * daily facts, the weekly ledger, the dated org history, the import batches
 * themselves, and the performance issues and action items the engine opened
 * off those numbers — including any RCA, action plan or acknowledgement
 * attached to them. That human work cannot survive the data it was written
 * about; an RCA against a week that no longer exists is a record of nothing.
 *
 * Deliberately kept:
 *   employees            - accounts link to them by EID, and EWS assessments,
 *                          PTO requests and ramp assignments all reference
 *                          them. A fresh import matches on EID and updates in
 *                          place, so keeping them costs nothing and deleting
 *                          them would orphan half the application.
 *   users, ews_assessments, pto_requests, employee_ramp_assignments
 *   kpi_definitions, skill_references, skill_aliases  - configuration, not data
 *   audit_log            - the record of what people did, which outlives any
 *                          particular import
 *
 *   npm run reset:imports            # report only
 *   npm run reset:imports -- --apply
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  acknowledgements,
  actionItems,
  actionPlans,
  employeeAssignments,
  importBatches,
  metricFacts,
  npsFacts,
  performanceIssues,
  qualityFacts,
  rcaEntries,
  rcaNotes,
  skillFacts,
  timeMotionStudies,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "../src/lib/db/schema";

const apply = process.argv.includes("--apply");

/** Children before parents: nothing here relies on a cascade. */
const ORDER = [
  ["rca_notes", rcaNotes],
  ["time_motion_studies", timeMotionStudies],
  ["rca_entries", rcaEntries],
  ["action_plans", actionPlans],
  ["acknowledgements", acknowledgements],
  ["action_items", actionItems],
  ["weekly_issue_history", weeklyIssueHistory],
  ["performance_issues", performanceIssues],
  ["weekly_metric_results", weeklyMetricResults],
  ["metric_facts", metricFacts],
  ["skill_facts", skillFacts],
  ["quality_facts", qualityFacts],
  ["nps_facts", npsFacts],
  ["employee_assignments", employeeAssignments],
  ["import_batches", importBatches],
] as const;

console.log(`mode: ${apply ? "APPLY (will delete)" : "dry run"}\n`);

let total = 0;
for (const [name, table] of ORDER) {
  const rows = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table as never)) as Array<{ n: number }>;
  const n = rows[0]?.n ?? 0;
  total += n;
  console.log(`  ${name.padEnd(24)} ${String(n).padStart(7)}`);
}
console.log(`\n  ${"total rows".padEnd(24)} ${String(total).padStart(7)}`);

const [emps] = await db.execute(
  sql`select count(*)::int n from employees`,
) as never as [{ n: number }];
console.log(`\nKept: ${emps.n} employees, plus users, EWS assessments, PTO, ramp and the audit log.`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  process.exit(0);
}

// One transaction: a half-cleared database is worse than either state — the
// engine would replay against facts whose issues had already been removed.
await db.transaction(async (tx) => {
  for (const [, table] of ORDER) await tx.delete(table as never);
});

console.log(`\nDeleted ${total} rows. Ready for a fresh import.`);
console.log("After uploading, run: npm run check:integrity");
process.exit(0);
