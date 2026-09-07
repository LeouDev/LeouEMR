/**
 * Clears a resolution date that falls before the issue was opened.
 *
 * An issue cannot have been resolved before it existed. The combination comes
 * from a replay that closed an issue on passing weeks predating the failure
 * that opened it — see the openedWeek rewind in reevaluate.mts, which stops
 * new ones being created. This clears the ones already written.
 *
 * The status is left alone deliberately. Whether a completed episode should
 * be reopened is a judgement about the person's performance, not a date
 * repair, and any RCA, action plan or acknowledgement attached to it stays
 * exactly where it is.
 *
 *   npm run fix:resolution            # report only
 *   npm run fix:resolution -- --apply
 */
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { employees, kpiDefinitions, performanceIssues } from "../src/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

const apply = process.argv.includes("--apply");
const backwards = and(
  isNotNull(performanceIssues.resolvedWeek),
  lt(performanceIssues.resolvedWeek, performanceIssues.openedWeek),
);

const rows = await db
  .select({
    id: performanceIssues.id,
    code: performanceIssues.code,
    status: performanceIssues.status,
    opened: performanceIssues.openedWeek,
    resolved: performanceIssues.resolvedWeek,
    kpi: kpiDefinitions.code,
    employee: employees.name,
    eid: employees.eid,
  })
  .from(performanceIssues)
  .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
  .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
  .where(backwards);

console.log(`mode: ${apply ? "APPLY (will update)" : "dry run"}`);
console.log(`\nissues resolved before they opened: ${rows.length}`);
console.table(
  rows.map(({ id, ...rest }) => rest),
);

if (rows.length === 0) {
  console.log("Nothing to fix.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to clear these resolution dates.");
  process.exit(0);
}

await db
  .update(performanceIssues)
  .set({ resolvedWeek: null, updatedAt: sql`now()` })
  .where(
    inArray(
      performanceIssues.id,
      rows.map((r) => r.id),
    ),
  );

console.log(`\nCleared the resolution date on ${rows.length} issue${rows.length === 1 ? "" : "s"}.`);
process.exit(0);
