/**
 * Deletes a performance issue and everything hanging off it.
 *
 * For issues that should never have existed — one raised against fabricated
 * data, say. This destroys human work: the RCA, the action plan and the
 * agent's acknowledgements go with it, which is exactly why it takes an
 * explicit code and prints what it is about to remove first.
 *
 * Prefer correcting an issue over deleting it. Reach for this only when the
 * underlying measurement never happened.
 *
 *   npm run delete-issue -- PI-2026-000610
 *   npm run delete-issue -- PI-2026-000610 --apply
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  acknowledgements,
  actionItems,
  actionPlans,
  employees,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  rcaNotes,
  timeMotionStudies,
  weeklyIssueHistory,
} from "../src/lib/db/schema";

const [code] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");

if (!code) {
  console.error("Usage: npm run delete-issue -- <PI-code> [--apply]");
  process.exit(1);
}

const [issue] = await db
  .select({
    id: performanceIssues.id,
    code: performanceIssues.code,
    status: performanceIssues.status,
    opened: performanceIssues.openedWeek,
    kpi: kpiDefinitions.code,
    employee: employees.name,
    eid: employees.eid,
  })
  .from(performanceIssues)
  .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
  .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
  .where(eq(performanceIssues.code, code));

if (!issue) {
  console.error(`No performance issue with code ${code}.`);
  process.exit(1);
}

const items = await db
  .select({ id: actionItems.id, code: actionItems.code })
  .from(actionItems)
  .where(eq(actionItems.performanceIssueId, issue.id));
const itemIds = items.map((i) => i.id);

const counts = async (label: string, n: number) => `${label}=${n}`;
const [hist, rca, plans, acks, notes, tms] = await Promise.all([
  db.select().from(weeklyIssueHistory).where(eq(weeklyIssueHistory.performanceIssueId, issue.id)),
  itemIds.length ? db.select().from(rcaEntries).where(inArray(rcaEntries.actionItemId, itemIds)) : [],
  itemIds.length ? db.select().from(actionPlans).where(inArray(actionPlans.actionItemId, itemIds)) : [],
  itemIds.length ? db.select().from(acknowledgements).where(inArray(acknowledgements.actionItemId, itemIds)) : [],
  itemIds.length ? db.select().from(rcaNotes).where(inArray(rcaNotes.actionItemId, itemIds)) : [],
  itemIds.length ? db.select().from(timeMotionStudies).where(inArray(timeMotionStudies.actionItemId, itemIds)) : [],
]);

console.log(`mode: ${apply ? "APPLY (will delete)" : "dry run"}`);
console.log(`\n${issue.code} — ${issue.kpi} for ${issue.employee} (${issue.eid})`);
console.log(`  status ${issue.status}, opened ${issue.opened}`);
console.log(
  `  will remove: ${[
    await counts("actionItems", items.length),
    await counts("weeklyHistory", hist.length),
    await counts("rca", rca.length),
    await counts("actionPlans", plans.length),
    await counts("acknowledgements", acks.length),
    await counts("rcaNotes", notes.length),
    await counts("timeMotionStudies", tms.length),
  ].join(", ")}`,
);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  process.exit(0);
}

// Children first, then the action item, then the issue — one transaction so a
// failure part-way cannot leave an action item pointing at a deleted issue.
await db.transaction(async (tx) => {
  if (itemIds.length > 0) {
    await tx.delete(rcaNotes).where(inArray(rcaNotes.actionItemId, itemIds));
    await tx.delete(timeMotionStudies).where(inArray(timeMotionStudies.actionItemId, itemIds));
    await tx.delete(rcaEntries).where(inArray(rcaEntries.actionItemId, itemIds));
    await tx.delete(actionPlans).where(inArray(actionPlans.actionItemId, itemIds));
    await tx.delete(acknowledgements).where(inArray(acknowledgements.actionItemId, itemIds));
    await tx.delete(actionItems).where(inArray(actionItems.id, itemIds));
  }
  await tx.delete(weeklyIssueHistory).where(eq(weeklyIssueHistory.performanceIssueId, issue.id));
  await tx.delete(performanceIssues).where(eq(performanceIssues.id, issue.id));
});

console.log(`\nDeleted ${issue.code} and its dependents.`);
process.exit(0);
