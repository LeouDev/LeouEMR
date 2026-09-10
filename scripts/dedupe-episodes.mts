/**
 * Finds — and, on request, removes — duplicate development-item episodes.
 *
 * Until the engine learned to check closed episodes (see loadFoldedResults
 * in src/lib/action-item-engine/persistence.ts), re-importing a week after
 * its episode had been closed on age opened a second episode for a failure
 * the closed one had already recorded. Such a duplicate is recognisable:
 * its opening week is a week an earlier episode of the same employee and
 * KPI already recorded as a failure, and it records no failure of its own
 * that the earlier one did not.
 *
 * Human work is never deleted: a duplicate carrying an RCA, an action plan,
 * an acknowledgement, a note or a time-and-motion study is reported and
 * left for a person to merge by hand.
 *
 *   npm run dedupe:episodes             # report only
 *   npm run dedupe:episodes -- --apply  # delete the duplicates with no human work
 */
import { inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  acknowledgements,
  actionItems,
  actionPlans,
  auditLog,
  employees,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  rcaNotes,
  timeMotionStudies,
  weeklyIssueHistory,
} from "../src/lib/db/schema";

const apply = process.argv.includes("--apply");

const issues = await db.select().from(performanceIssues);
const history = await db.select().from(weeklyIssueHistory);
const items = await db
  .select({ id: actionItems.id, code: actionItems.code, issueId: actionItems.performanceIssueId })
  .from(actionItems);
const kpis = new Map((await db.select().from(kpiDefinitions)).map((k) => [k.id, k.code]));
const names = new Map((await db.select().from(employees)).map((e) => [e.id, `${e.name} (${e.eid})`]));

const historyByIssue = new Map<string, Map<string, "pass" | "fail">>();
for (const row of history) {
  const weeks = historyByIssue.get(row.performanceIssueId) ?? new Map();
  weeks.set(row.week, row.result);
  historyByIssue.set(row.performanceIssueId, weeks);
}
const itemByIssue = new Map(items.map((i) => [i.issueId, i]));

// Episodes per employee+KPI, oldest first — the code sequence is creation order.
const byPair = new Map<string, typeof issues>();
for (const issue of issues) {
  const key = `${issue.employeeId}|${issue.kpiId}`;
  byPair.set(key, [...(byPair.get(key) ?? []), issue]);
}

interface Duplicate {
  issue: (typeof issues)[number];
  of: (typeof issues)[number];
  item: { id: string; code: string } | undefined;
}
const duplicates: Duplicate[] = [];
for (const episodes of byPair.values()) {
  episodes.sort((a, b) => a.code.localeCompare(b.code));
  for (let i = 1; i < episodes.length; i += 1) {
    const later = episodes[i];
    const mine = historyByIssue.get(later.id) ?? new Map<string, "pass" | "fail">();
    const earlier = episodes.slice(0, i).find((e) => historyByIssue.get(e.id)?.get(later.openedWeek) === "fail");
    if (!earlier) continue;
    const theirs = historyByIssue.get(earlier.id) ?? new Map<string, "pass" | "fail">();
    // A failure of its own — one the earlier episode never recorded — makes
    // it a real episode, however it began.
    const ownFailure = [...mine].some(([week, result]) => result === "fail" && theirs.get(week) !== "fail");
    if (ownFailure) continue;
    duplicates.push({ issue: later, of: earlier, item: itemByIssue.get(later.id) });
  }
}

const itemIds = duplicates.flatMap((d) => (d.item ? [d.item.id] : []));
const [rca, plans, acks, notes, tms] = itemIds.length
  ? await Promise.all([
      db.select({ id: rcaEntries.actionItemId }).from(rcaEntries).where(inArray(rcaEntries.actionItemId, itemIds)),
      db.select({ id: actionPlans.actionItemId }).from(actionPlans).where(inArray(actionPlans.actionItemId, itemIds)),
      db.select({ id: acknowledgements.actionItemId }).from(acknowledgements).where(inArray(acknowledgements.actionItemId, itemIds)),
      db.select({ id: rcaNotes.actionItemId }).from(rcaNotes).where(inArray(rcaNotes.actionItemId, itemIds)),
      db.select({ id: timeMotionStudies.actionItemId }).from(timeMotionStudies).where(inArray(timeMotionStudies.actionItemId, itemIds)),
    ])
  : [[], [], [], [], []];
const withHumanWork = new Set([...rca, ...plans, ...acks, ...notes, ...tms].map((r) => r.id));

const removable = duplicates.filter((d) => !d.item || !withHumanWork.has(d.item.id));
const kept = duplicates.filter((d) => d.item && withHumanWork.has(d.item.id));

console.log(`mode: ${apply ? "APPLY (will delete)" : "report only"}`);
console.log(`\n${duplicates.length} duplicate episode(s) across ${issues.length} issues`);
const byKpi = new Map<string, number>();
for (const d of duplicates) byKpi.set(kpis.get(d.issue.kpiId) ?? d.issue.kpiId, (byKpi.get(kpis.get(d.issue.kpiId) ?? d.issue.kpiId) ?? 0) + 1);
for (const [kpi, n] of [...byKpi].sort()) console.log(`  ${kpi}: ${n}`);

console.log(`\nRemovable (no human work): ${removable.length}`);
for (const d of removable) {
  console.log(
    `  ${d.item?.code ?? d.issue.code} ${d.issue.status} opened ${d.issue.openedWeek} — ${kpis.get(d.issue.kpiId)} for ${names.get(d.issue.employeeId)} — duplicates ${itemByIssue.get(d.of.id)?.code ?? d.of.code} (${d.of.status})`,
  );
}
if (kept.length > 0) {
  console.log(`\nLeft alone, carrying RCA/plan/acknowledgement/notes: ${kept.length}`);
  for (const d of kept) {
    console.log(`  ${d.item?.code ?? d.issue.code} — ${kpis.get(d.issue.kpiId)} for ${names.get(d.issue.employeeId)} — duplicates ${itemByIssue.get(d.of.id)?.code ?? d.of.code}`);
  }
}

if (!apply) {
  console.log("\nReport only. Re-run with --apply to delete the removable ones.");
  process.exit(0);
}

for (const d of removable) {
  const ids = d.item ? [d.item.id] : [];
  await db.transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.delete(rcaNotes).where(inArray(rcaNotes.actionItemId, ids));
      await tx.delete(timeMotionStudies).where(inArray(timeMotionStudies.actionItemId, ids));
      await tx.delete(rcaEntries).where(inArray(rcaEntries.actionItemId, ids));
      await tx.delete(actionPlans).where(inArray(actionPlans.actionItemId, ids));
      await tx.delete(acknowledgements).where(inArray(acknowledgements.actionItemId, ids));
      await tx.delete(actionItems).where(inArray(actionItems.id, ids));
    }
    await tx.delete(weeklyIssueHistory).where(inArray(weeklyIssueHistory.performanceIssueId, [d.issue.id]));
    await tx.delete(performanceIssues).where(inArray(performanceIssues.id, [d.issue.id]));
    // Its own action, so the removal is never mistaken for a completion.
    await tx.insert(auditLog).values({
      action: "issue.duplicate_removed",
      entityType: "performance_issue",
      entityId: d.issue.id,
      before: { code: d.issue.code, status: d.issue.status, openedWeek: d.issue.openedWeek },
      after: { duplicateOf: d.of.id, reason: "opened on a week an earlier episode had already recorded" },
    });
  });
}
console.log(`\nDeleted ${removable.length} duplicate episode(s).`);
process.exit(0);
