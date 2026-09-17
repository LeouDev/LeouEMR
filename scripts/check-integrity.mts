/**
 * Invariants that should hold for every performance issue and weekly result.
 *
 * Written after a batch of rows inserted straight into the database — with no
 * import batch behind them — silently closed four real action items by
 * supplying four fabricated passing weeks. Each check below is a thing that
 * went wrong once and should never be true again.
 *
 * Exits non-zero if anything fails, so it can gate a deploy or follow a
 * reevaluate.
 *
 *   npm run check:integrity
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";

interface Check {
  name: string;
  why: string;
  query: ReturnType<typeof sql>;
}

const CHECKS: Check[] = [
  {
    name: "weekly results with no source import",
    why: "every legitimate row records the import batch that wrote it",
    query: sql`select count(*)::int as n from weekly_metric_results where source_import_id is null`,
  },
  {
    name: "daily facts with no source import",
    why: "same rule, one level down",
    query: sql`select count(*)::int as n from metric_facts where source_import_id is null`,
  },
  {
    name: "issues resolved before they opened",
    why: "an issue cannot be closed before it exists",
    query: sql`select count(*)::int as n from performance_issues
               where resolved_week is not null and resolved_week < opened_week`,
  },
  {
    name: "history rows predating their issue",
    why: "a week before the opening failure must not count toward closing it",
    query: sql`select count(*)::int as n from weekly_issue_history h
               join performance_issues i on i.id = h.performance_issue_id
               where h.week < i.opened_week`,
  },
  {
    name: "issues for a KPI the employee was never measured on",
    why: "nothing can fail a metric that was never recorded",
    query: sql`select count(*)::int as n from performance_issues i
               where not exists (select 1 from weekly_metric_results w
                                 where w.employee_id = i.employee_id and w.kpi_id = i.kpi_id)`,
  },
  {
    name: "issues with no action item",
    why: "the two are created together and are 1:1",
    query: sql`select count(*)::int as n from performance_issues i
               where not exists (select 1 from action_items a where a.performance_issue_id = i.id)`,
  },
  {
    name: "employees with two live issues for one KPI",
    why: "a second issue must not open while one is still live",
    query: sql`select count(*)::int as n from (
                 select employee_id, kpi_id from performance_issues
                 where status in ('OPEN','AWAITING_AGENT_ACKNOWLEDGEMENT','ACKNOWLEDGED',
                                  'MONITORING','SUSTAINED','REOPENED')
                 group by employee_id, kpi_id having count(*) > 1
               ) d`,
  },
  {
    name: "active employees whose newest assignment is closed",
    why: "only a masterlist closes a person's newest interval, and it marks the row separated as it does; an active row over a closed history is a broken org history (the 17 Sep 2026 splice bug) — re-upload the month's masterlist",
    query: sql`select count(*)::int as n from employees e
               where e.status = 'active'
                 and exists (select 1 from employee_assignments a where a.employee_id = e.id)
                 and not exists (select 1 from employee_assignments a
                                 where a.employee_id = e.id and a.effective_to is null)`,
  },
  {
    name: "work closed on separation for someone still here",
    why: "an item completed 'on separation' whose owner is active and whose stint never ended — the separation was inferred from a broken org history; npm run fix:false-separations reopens and replays them (items on KPIs that no longer open action items are left alone: every list hides them either way)",
    query: sql`select count(*)::int as n from performance_issues i
               join employees e on e.id = i.employee_id
               join kpi_definitions k on k.id = i.kpi_id
               where i.status = 'COMPLETED' and e.status = 'active' and k.generates_action_items
                 and (select l.action from audit_log l where l.entity_id = i.id
                       order by l.created_at desc limit 1) = 'issue.closed_on_separation'
                 and exists (select 1 from employee_assignments a
                             where a.employee_id = i.employee_id and a.effective_to is null
                               and a.effective_from <= i.resolved_week)`,
  },
  {
    name: "weekly results dated outside their own week",
    why: "week_end must be six days after week_start (the one exception is the eight-day week of 23 May 2026, where the Saturday-to-Friday weeks hand over to Sunday-to-Saturday — src/lib/queries/period.ts)",
    query: sql`select count(*)::int as n from weekly_metric_results
               where week_end <> week_start + interval '6 days'
                 and not (week_start = '2026-05-23' and week_end = '2026-05-30')`,
  },
  {
    name: "weekly results off the reporting-week grid",
    why: "from 31 May 2026 every week starts on a Sunday; before it, on a Saturday (migration 0055 moved the keys)",
    query: sql`select count(*)::int as n from weekly_metric_results
               where (week_start >= '2026-05-31' and extract(dow from week_start) <> 0)
                  or (week_start < '2026-05-31' and extract(dow from week_start) <> 6)`,
  },
];

let failures = 0;
console.log("Integrity checks\n");

for (const check of CHECKS) {
  const result = await db.execute(check.query as never);
  const rows = (result as never as { rows?: Array<{ n: number }> }).rows ?? (result as never as Array<{ n: number }>);
  const n = Number(rows[0]?.n ?? 0);
  const ok = n === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${check.name}: ${n}`);
  if (!ok) console.log(`        ${check.why}`);
}

console.log(
  failures === 0
    ? "\nAll checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
