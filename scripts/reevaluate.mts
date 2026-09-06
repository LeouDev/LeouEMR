/**
 * Re-evaluates stored performance against the current KPI thresholds.
 *
 * Changing a threshold invalidates everything derived from it: the stored
 * pass/fail on each weekly metric, and the issues opened off those
 * failures. Re-importing alone will not fix it, because the issue engine
 * deliberately skips weeks it has already consumed.
 *
 * Human work is preserved. Issues carrying an RCA, an action plan or an
 * acknowledgement are kept and replayed; purely derived issues with no
 * human input are rebuilt from scratch.
 *
 *   npm run reevaluate
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  acknowledgements,
  actionItems,
  actionPlans,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  weeklyIssueHistory,
  weeklyMetricResults,
} from "../src/lib/db/schema";
import { runIssueEngineForWeeks } from "../src/lib/action-item-engine/persistence";
import { evaluateKpi } from "../src/lib/kpi-engine/evaluate";
import type { KpiDefinition } from "../src/lib/kpi-engine/types";

const definitions = await db.select().from(kpiDefinitions).where(eq(kpiDefinitions.active, true));
const byId = new Map(
  definitions.map((row) => [
    row.id,
    {
      code: row.code,
      name: row.name,
      type: row.type,
      direction: row.direction,
      target: row.target ?? undefined,
      warningThreshold: row.warningThreshold ?? undefined,
      failureThreshold: row.failureThreshold ?? undefined,
      rangeMin: row.rangeMin ?? undefined,
      rangeMax: row.rangeMax ?? undefined,
      expected: row.expectedBoolean ?? undefined,
    } satisfies KpiDefinition,
  ]),
);

console.log("Active KPI thresholds:");
for (const d of definitions) {
  console.log(`  ${d.code}: target=${d.target} warn=${d.warningThreshold} fail=${d.failureThreshold}`);
}

// 1. Recompute each metric's status under the current thresholds.
const metrics = await db.select().from(weeklyMetricResults);
const changes: Array<{ id: string; status: "pass" | "warning" | "fail" }> = [];

for (const metric of metrics) {
  const definition = byId.get(metric.kpiId);
  if (!definition) continue;

  // A target carried by the source row still wins, exactly as at import time.
  const effective =
    metric.targetValue !== null && Number.isFinite(metric.targetValue)
      ? { ...definition, target: metric.targetValue, failureThreshold: metric.targetValue, warningThreshold: undefined }
      : definition;

  const status = evaluateKpi(metric.actualValue, effective).status.toLowerCase() as
    | "pass"
    | "warning"
    | "fail";

  if (status !== metric.status) changes.push({ id: metric.id, status });
}

console.log(`\n${changes.length} of ${metrics.length} metric statuses change`);

const CHUNK = 500;
for (let i = 0; i < changes.length; i += CHUNK) {
  const slice = changes.slice(i, i + CHUNK);
  const values = sql.join(
    slice.map((c) => sql`(${c.id}::uuid, ${c.status}::kpi_status)`),
    sql`, `,
  );
  await db.execute(sql`
    update ${weeklyMetricResults} as m set status = v.status
    from (values ${values}) as v(id, status) where m.id = v.id
  `);
}

// 2. Drop derived issues that carry no human work; keep the rest.
const withHumanWork = new Set<string>();
for (const table of [rcaEntries, actionPlans, acknowledgements]) {
  const rows = await db
    .select({ issueId: actionItems.performanceIssueId })
    .from(table)
    .innerJoin(actionItems, eq(actionItems.id, table.actionItemId));
  for (const row of rows) withHumanWork.add(row.issueId);
}

const all = await db.select({ id: performanceIssues.id }).from(performanceIssues);
const disposable = all.map((r) => r.id).filter((id) => !withHumanWork.has(id));

console.log(
  `Rebuilding ${disposable.length} derived issues; preserving ${withHumanWork.size} with RCA, plan or acknowledgement`,
);

for (let i = 0; i < disposable.length; i += CHUNK) {
  const slice = disposable.slice(i, i + CHUNK);
  await db.delete(weeklyIssueHistory).where(inArray(weeklyIssueHistory.performanceIssueId, slice));
  await db.delete(actionItems).where(inArray(actionItems.performanceIssueId, slice));
  await db.delete(performanceIssues).where(inArray(performanceIssues.id, slice));
}

// 3. Rewind surviving issues so the engine replays every week against them.
if (withHumanWork.size > 0) {
  await db
    .update(performanceIssues)
    .set({ lastEvaluatedWeek: null, consecutivePassingWeeks: 0 })
    .where(inArray(performanceIssues.id, [...withHumanWork]));
  await db
    .delete(weeklyIssueHistory)
    .where(inArray(weeklyIssueHistory.performanceIssueId, [...withHumanWork]));
}

// 4. Replay every week in order.
const weeks = await db
  .selectDistinct({ week: weeklyMetricResults.weekStart })
  .from(weeklyMetricResults)
  .orderBy(weeklyMetricResults.weekStart);

const result = await runIssueEngineForWeeks(weeks.map((w) => w.week));
console.log(`\nEngine replay: ${result.opened} opened, ${result.updated} updated`);

const summary = await db
  .select({ code: kpiDefinitions.code, status: weeklyMetricResults.status, n: sql<number>`count(*)::int` })
  .from(weeklyMetricResults)
  .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
  .groupBy(kpiDefinitions.code, weeklyMetricResults.status);

console.log("\nPass/fail by KPI:");
const grouped = new Map<string, Record<string, number>>();
for (const row of summary) {
  const entry = grouped.get(row.code) ?? {};
  entry[row.status] = row.n;
  grouped.set(row.code, entry);
}
for (const [code, counts] of [...grouped].sort()) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const fails = counts.fail ?? 0;
  console.log(`  ${code}: ${fails} fail of ${total} (${((fails / total) * 100).toFixed(1)}%)`);
}

process.exit(0);
