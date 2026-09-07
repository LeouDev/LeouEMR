import { db } from "../src/lib/db/client";
import { weeklyMetricResults, metricFacts, skillFacts, qualityFacts, npsFacts,
  employees, kpiDefinitions, performanceIssues, importBatches } from "../src/lib/db/schema";
import { sql, eq, and, gte, inArray } from "drizzle-orm";

const [emp] = await db.select({ id: employees.id, eid: employees.eid, name: employees.name })
  .from(employees).where(eq(employees.eid, "900130217"));
console.log("employee:", emp);

const CUT = "2026-09-05"; // first stray week start

const wk = await db.select({ week: weeklyMetricResults.weekStart, kpi: kpiDefinitions.code,
  v: weeklyMetricResults.actualValue, status: weeklyMetricResults.status,
  sample: weeklyMetricResults.sampleSize, imp: weeklyMetricResults.sourceImportId })
  .from(weeklyMetricResults).innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
  .where(and(eq(weeklyMetricResults.employeeId, emp.id), gte(weeklyMetricResults.weekStart, CUT)))
  .orderBy(weeklyMetricResults.weekStart);
console.log(`\nweekly rows >= ${CUT}: ${wk.length}`);
console.table(wk);

for (const [label, tbl, col] of [
  ["metric_facts", metricFacts, metricFacts.factDate],
  ["skill_facts", skillFacts, skillFacts.factDate],
  ["quality_facts", qualityFacts, qualityFacts.factDate],
  ["nps_facts", npsFacts, npsFacts.factDate],
] as const) {
  const rows = await db.select({ d: sql<string>`${col}::text`, n: sql<number>`count(*)::int` })
    .from(tbl as never).where(and(eq((tbl as never as typeof metricFacts).employeeId, emp.id), gte(col, CUT)))
    .groupBy(col).orderBy(col);
  console.log(`${label} >= ${CUT}:`, rows.length ? JSON.stringify(rows) : "none");
}

const issues = await db.select({ code: performanceIssues.code, kpi: kpiDefinitions.code,
  status: performanceIssues.status, opened: performanceIssues.openedWeek,
  lastEval: performanceIssues.lastEvaluatedWeek, resolved: performanceIssues.resolvedWeek })
  .from(performanceIssues).innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
  .where(eq(performanceIssues.employeeId, emp.id));
console.log(`\naction items for this employee: ${issues.length}`);
console.table(issues);
process.exit(0);
