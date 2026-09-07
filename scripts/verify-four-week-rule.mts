/**
 * Integration check for the 4-week sustained-performance rule against the
 * live database.
 *
 * The pure engine is unit tested (src/lib/action-item-engine/engine.test.ts),
 * but that does not prove the persistence path applies it correctly. This
 * drives a real acknowledged issue through five synthetic passing weeks
 * using the production code path, asserts the progression, then removes
 * everything it inserted.
 *
 * The synthetic weeks are stamped with a dedicated import batch, named so it
 * is obvious in the table what they are. That is not bookkeeping: rows with
 * no import behind them are indistinguishable from imported ones, and a run
 * of this script that died before its cleanup once left sixteen such rows in
 * production — closing four real action items on fabricated passing weeks.
 * The batch id makes any leftovers attributable and deletable, and the
 * NOT NULL on source_import_id (migration 0039) makes the old unstamped
 * write impossible.
 *
 * The cleanup runs in a finally block for the same reason.
 *
 *   npm run verify:four-week -- PA-2026-000610
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  actionItems,
  importBatches,
  performanceIssues,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "../src/lib/db/schema";
import { runIssueEngineForWeeks } from "../src/lib/action-item-engine/persistence";
import { acknowledgeByAgent, submitRcaAndActionPlan } from "../src/lib/action-item-engine/engine";

const code = process.argv[2];
if (!code) {
  console.error("Usage: npm run verify:four-week -- <ACTION_ITEM_CODE>");
  process.exit(1);
}

const [target] = await db
  .select({
    issueId: performanceIssues.id,
    employeeId: performanceIssues.employeeId,
    kpiId: performanceIssues.kpiId,
    status: performanceIssues.status,
    lastEvaluatedWeek: performanceIssues.lastEvaluatedWeek,
    openedWeek: performanceIssues.openedWeek,
  })
  .from(actionItems)
  .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
  .where(eq(actionItems.code, code))
  .limit(1);

if (!target) {
  console.error(`No action item ${code}`);
  process.exit(1);
}
const originalStatus = target.status;

// Monitoring only begins once the agent has acknowledged, so drive the real
// transitions first rather than writing the status directly. This exercises
// the same engine functions the UI calls.
if (target.status === "OPEN" || target.status === "REOPENED") {
  const submitted = submitRcaAndActionPlan(
    { status: target.status, consecutivePassingWeeks: 0, openedWeek: target.openedWeek },
    target.openedWeek,
  );
  const acknowledged = acknowledgeByAgent(submitted.issue, target.openedWeek);
  await db
    .update(performanceIssues)
    .set({ status: acknowledged.issue.status })
    .where(eq(performanceIssues.id, target.issueId));
  await db
    .update(actionItems)
    .set({ status: acknowledged.issue.status })
    .where(eq(actionItems.code, code));
  console.log(`Advanced ${originalStatus} -> AWAITING_AGENT_ACKNOWLEDGEMENT -> ACKNOWLEDGED\n`);
  target.status = "ACKNOWLEDGED";
}

if (target.status !== "ACKNOWLEDGED") {
  console.error(`Issue must reach ACKNOWLEDGED to start monitoring; it is ${target.status}`);
  process.exit(1);
}

// Five passing weeks after the last one already evaluated.
const start = new Date(`${target.lastEvaluatedWeek}T00:00:00Z`);
const weeks: string[] = [];
for (let i = 1; i <= 5; i++) {
  const week = new Date(start);
  week.setUTCDate(week.getUTCDate() + 7 * i);
  weeks.push(week.toISOString().slice(0, 10));
}

console.log(`Seeding passing weeks for ${code}: ${weeks.join(", ")}\n`);

// Named so anyone reading import_batches or the rows themselves can see at a
// glance that this is a test fixture and not imported production data.
const [batch] = await db
  .insert(importBatches)
  .values({ fileName: `verify-four-week-rule ${code} (synthetic)`, status: "committed" })
  .returning({ id: importBatches.id });

let failures = 0;
try {
for (const week of weeks) {
  const end = new Date(`${week}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  await db
    .insert(weeklyMetricResults)
    .values({
      employeeId: target.employeeId,
      kpiId: target.kpiId,
      weekStart: week,
      weekEnd: end.toISOString().slice(0, 10),
      actualValue: 12.5,
      targetValue: 11,
      status: "pass",
      sampleSize: 5,
      sourceImportId: batch.id,
    })
    .onConflictDoNothing();
}

const expected = [
  { week: weeks[0], status: "MONITORING", consecutive: 1 },
  { week: weeks[1], status: "MONITORING", consecutive: 2 },
  { week: weeks[2], status: "MONITORING", consecutive: 3 },
  { week: weeks[3], status: "SUSTAINED", consecutive: 4 },
  { week: weeks[4], status: "COMPLETED", consecutive: 5 },
];

for (const step of expected) {
  await runIssueEngineForWeeks([step.week]);

  const [actual] = await db
    .select({
      status: performanceIssues.status,
      consecutive: performanceIssues.consecutivePassingWeeks,
      resolvedWeek: performanceIssues.resolvedWeek,
    })
    .from(performanceIssues)
    .where(eq(performanceIssues.id, target.issueId))
    .limit(1);

  const ok = actual.status === step.status && actual.consecutive === step.consecutive;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "PASS" : "FAIL"}  ${step.week}  expected ${step.status} ${step.consecutive}/4  ` +
      `got ${actual.status} ${actual.consecutive}/4`,
  );
}

// Also confirm the action item mirrors the issue's final state.
const [item] = await db
  .select({ status: actionItems.status })
  .from(actionItems)
  .where(eq(actionItems.code, code))
  .limit(1);
const mirrored = item.status === "COMPLETED";
if (!mirrored) failures += 1;
console.log(`${mirrored ? "PASS" : "FAIL"}  action item mirrors issue status (got ${item.status})`);

} finally {
// Always runs, including on a failed assertion or an interrupted connection:
// leaving synthetic passing weeks behind is how four real action items were
// closed on data nobody imported.
console.log("\nCleaning up synthetic weeks…");
await db
  .delete(weeklyIssueHistory)
  .where(
    and(
      eq(weeklyIssueHistory.performanceIssueId, target.issueId),
      gte(weeklyIssueHistory.week, weeks[0]),
    ),
  );
// By batch id, so it cannot miss a row or reach one it did not write.
await db.delete(weeklyMetricResults).where(eq(weeklyMetricResults.sourceImportId, batch.id));
await db
  .update(performanceIssues)
  .set({
    status: originalStatus,
    consecutivePassingWeeks: 0,
    resolvedWeek: null,
    lastEvaluatedWeek: target.lastEvaluatedWeek,
  })
  .where(eq(performanceIssues.id, target.issueId));
await db
  .update(actionItems)
  .set({ status: originalStatus })
  .where(eq(actionItems.code, code));
await db.delete(importBatches).where(eq(importBatches.id, batch.id));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
