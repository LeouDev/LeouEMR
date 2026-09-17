/**
 * Reopens development items the separation sweep closed for people who
 * never left, and replays their weeks.
 *
 * The sweep (closeIssuesOfSeparated) completes every open item of anyone
 * with a separation date. On 17 Sep 2026 a splice bug closed a listed
 * team's assignment intervals at a month's eve, the sweep read that as
 * their separation and completed 33 items that were a fortnight old. The
 * sweep now refuses a separation the employee row does not confirm, and
 * the nightly integrity check reports the pattern; this is the repair.
 *
 * An item qualifies when its latest audit entry is the separation
 * closure, its owner's row is active, the owner's open assignment began
 * on or before the closure week (the stint never ended), it carries no
 * RCA, plan, acknowledgement or note, and no other live item exists for
 * the same person and KPI. Where one person and KPI has two such items,
 * the later one opened only because the first had just been closed: it
 * is removed and the first replays as one episode. Every change gets an
 * audit entry. Then the engine replays every week from the earliest
 * reopened item on, the same rewind reevaluate.mts uses.
 *
 *   npm run fix:false-separations            # report only
 *   npm run fix:false-separations -- --apply
 */
import { asc, gte, inArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { actionItems, auditLog, performanceIssues, weeklyIssueHistory, weeklyMetricResults } from "../src/lib/db/schema";
import { runIssueEngineForWeeks } from "../src/lib/action-item-engine/persistence";

interface Candidate {
  id: string;
  employee_id: string;
  kpi_id: string;
  employee: string;
  kpi: string;
  opened_week: string;
  resolved_week: string;
  closed_on: string;
}

const apply = process.argv.includes("--apply");
console.log(`mode: ${apply ? "APPLY (will reopen and replay)" : "dry run"}\n`);

const result = await db.execute(sql`
  select i.id, i.employee_id, i.kpi_id, e.name as employee, k.code as kpi,
         i.opened_week::text as opened_week, i.resolved_week::text as resolved_week,
         (select l.created_at::date::text from audit_log l where l.entity_id = i.id
           order by l.created_at desc limit 1) as closed_on
  from performance_issues i
  join employees e on e.id = i.employee_id
  join kpi_definitions k on k.id = i.kpi_id
  where i.status = 'COMPLETED' and e.status = 'active'
    and (select l.action from audit_log l where l.entity_id = i.id
          order by l.created_at desc limit 1) = 'issue.closed_on_separation'
    and exists (select 1 from employee_assignments a
                where a.employee_id = i.employee_id and a.effective_to is null
                  and a.effective_from <= i.resolved_week)
    and not exists (select 1 from action_items a
                    left join rca_entries r on r.action_item_id = a.id
                    left join action_plans p on p.action_item_id = a.id
                    left join acknowledgements c on c.action_item_id = a.id
                    left join rca_notes n on n.action_item_id = a.id
                    where a.performance_issue_id = i.id
                      and (r.id is not null or p.id is not null or c.id is not null or n.id is not null))
    and not exists (select 1 from performance_issues o
                    where o.employee_id = i.employee_id and o.kpi_id = i.kpi_id
                      and o.id <> i.id and o.status <> 'COMPLETED')
  order by e.name, k.code, i.opened_week
`);
const candidates = ((result as never as { rows?: Candidate[] }).rows ?? (result as never as Candidate[])) as Candidate[];

// The earliest item per person and KPI is the episode; any later one is a
// duplicate opened after the first was wrongly closed.
const earliest = new Map<string, Candidate>();
for (const c of candidates) {
  const key = `${c.employee_id}|${c.kpi_id}`;
  const prior = earliest.get(key);
  if (!prior || c.opened_week < prior.opened_week) earliest.set(key, c);
}
const keep = [...earliest.values()];
const keepIds = new Set(keep.map((c) => c.id));
const duplicates = candidates.filter((c) => !keepIds.has(c.id));

console.log(`items closed on a separation their owner's row does not confirm: ${candidates.length}`);
console.table(
  candidates.map((c) => ({
    employee: c.employee,
    kpi: c.kpi,
    opened: c.opened_week,
    closed_on: c.closed_on,
    action: keepIds.has(c.id) ? "reopen" : "remove (duplicate episode)",
  })),
);

if (candidates.length === 0) {
  console.log("Nothing to repair.");
  process.exit(0);
}
if (!apply) {
  console.log(`\nDry run. Re-run with --apply to reopen ${keep.length} and remove ${duplicates.length}.`);
  process.exit(0);
}

await db.transaction(async (tx) => {
  const allIds = candidates.map((c) => c.id);
  await tx.delete(weeklyIssueHistory).where(inArray(weeklyIssueHistory.performanceIssueId, allIds));

  if (duplicates.length > 0) {
    const dupIds = duplicates.map((c) => c.id);
    await tx.insert(auditLog).values(
      duplicates.map((c) => ({
        action: "issue.deleted_duplicate_episode",
        entityType: "performance_issue",
        entityId: c.id,
        before: { status: "COMPLETED", openedWeek: c.opened_week },
        after: {
          reason: "opened only because the earlier episode had been closed on a separation the employee row never confirmed; the earlier episode is reopened and replayed",
        },
      })),
    );
    await tx.delete(actionItems).where(inArray(actionItems.performanceIssueId, dupIds));
    await tx.delete(performanceIssues).where(inArray(performanceIssues.id, dupIds));
  }

  const ids = keep.map((c) => c.id);
  await tx
    .update(performanceIssues)
    .set({
      status: "OPEN",
      resolvedWeek: null,
      consecutivePassingWeeks: 0,
      lastEvaluatedWeek: sql`${performanceIssues.openedWeek} - interval '1 day'`,
      updatedAt: sql`now()`,
    })
    .where(inArray(performanceIssues.id, ids));
  await tx
    .update(actionItems)
    .set({ status: "OPEN", updatedAt: sql`now()` })
    .where(inArray(actionItems.performanceIssueId, ids));
  await tx.insert(auditLog).values(
    keep.map((c) => ({
      action: "issue.reopened_false_separation",
      entityType: "performance_issue",
      entityId: c.id,
      before: { status: "COMPLETED", resolvedWeek: c.resolved_week },
      after: { status: "OPEN", reason: "closed on a separation the employee row never confirmed; the person never left" },
    })),
  );
});
console.log(`\nReopened ${keep.length}, removed ${duplicates.length} duplicate episode${duplicates.length === 1 ? "" : "s"}.`);

// Replay from the earliest reopened week so each item folds every week since.
const from = keep.map((c) => c.opened_week).sort()[0];
const weeks = await db
  .selectDistinct({ week: weeklyMetricResults.weekStart })
  .from(weeklyMetricResults)
  .where(gte(weeklyMetricResults.weekStart, from))
  .orderBy(asc(weeklyMetricResults.weekStart));
const replay = await runIssueEngineForWeeks(weeks.map((w) => w.week));
console.log(
  `Replayed ${weeks.length} week${weeks.length === 1 ? "" : "s"} from ${from}: ${replay.updated} updated, ${replay.opened} opened, ${replay.corrected} corrected.`,
);
process.exit(0);
