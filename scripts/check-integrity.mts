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
    name: "weekly results dated outside their own week",
    why: "week_end must be six days after week_start",
    query: sql`select count(*)::int as n from weekly_metric_results
               where week_end <> week_start + interval '6 days'`,
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
