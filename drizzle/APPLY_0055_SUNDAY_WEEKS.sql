-- One paste, one transaction: apply migration 0055 (reporting weeks run
-- Sunday to Saturday from 31 May 2026) and record it in drizzle's tracker,
-- the way this project applies migrations to production (the Supabase SQL
-- editor as postgres). Safe to run twice: only Saturday-keyed week values
-- from 30 May 2026 on are moved, never onto a key that already exists, and
-- the tracker insert is guarded.
-- Run after APPLY_0054_TWO_NESTING_WEEKS.sql, and BEFORE the release that
-- carries it is deployed. The full order of operations, with the checks to
-- run before and after, is in docs/sunday-week-recut.md.
--
-- What it does: every stored week key from Sat 30 May 2026 on — the weekly
-- ledger's week_start/week_end, the action-item engine's opened, last
-- evaluated and resolved weeks and its weekly history, RCA note weeks, EWS
-- assessment weeks and ramp start weeks — moves one day forward onto its
-- Sunday. The week of Sat 23 May 2026 keeps its start and now ends Sat 30
-- May. Daily facts are untouched; re-importing each workbook with rows
-- dated 30 May 2026 or later rebuilds the weekly figures on the new grid.

begin;

-- Reporting weeks run Sunday to Saturday from 31 May 2026
-- (src/lib/queries/period.ts). Every week key stored from that point was
-- written under the old Saturday-to-Friday grid and moves one day forward,
-- onto its Sunday. The week of Sat 23 May 2026 — the last old-grid week —
-- keeps its start and runs to Sat 30 May, so the two grids meet with no
-- gap and no one-day week. Daily facts (metric_facts, skill_facts,
-- quality_facts, nps_facts) carry their own dates and are untouched; a
-- re-import of each workbook with rows dated 30 May 2026 or later rebuilds
-- the weekly figures on the new grid from them.
--
-- Only Saturday-keyed values from 30 May 2026 on are touched, and a keyed
-- row is never moved onto a key that already exists, so a second run is a
-- no-op and a week already re-imported on the new grid is never overwritten.
UPDATE "weekly_metric_results" w SET "week_start" = w."week_start" + 1
 WHERE w."week_start" >= '2026-05-30' AND extract(dow from w."week_start") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "weekly_metric_results" x
      WHERE x."employee_id" = w."employee_id" AND x."kpi_id" = w."kpi_id" AND x."week_start" = w."week_start" + 1);
UPDATE "weekly_metric_results" SET "week_end" = "week_start" + 6
 WHERE "week_start" >= '2026-05-31' AND extract(dow from "week_start") = 0 AND "week_end" <> "week_start" + 6;
UPDATE "weekly_metric_results" SET "week_end" = '2026-05-30'
 WHERE "week_start" = '2026-05-23' AND "week_end" = '2026-05-29';
UPDATE "performance_issues" SET "opened_week" = "opened_week" + 1
 WHERE "opened_week" >= '2026-05-30' AND extract(dow from "opened_week") = 6;
UPDATE "performance_issues" SET "last_evaluated_week" = "last_evaluated_week" + 1
 WHERE "last_evaluated_week" >= '2026-05-30' AND extract(dow from "last_evaluated_week") = 6;
UPDATE "performance_issues" SET "resolved_week" = "resolved_week" + 1
 WHERE "resolved_week" >= '2026-05-30' AND extract(dow from "resolved_week") = 6;
UPDATE "weekly_issue_history" h SET "week" = h."week" + 1
 WHERE h."week" >= '2026-05-30' AND extract(dow from h."week") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "weekly_issue_history" x
      WHERE x."performance_issue_id" = h."performance_issue_id" AND x."week" = h."week" + 1);
UPDATE "rca_notes" SET "week" = "week" + 1
 WHERE "week" >= '2026-05-30' AND extract(dow from "week") = 6;
UPDATE "ews_assessments" e SET "week" = e."week" + 1
 WHERE e."week" >= '2026-05-30' AND extract(dow from e."week") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "ews_assessments" x
      WHERE x."employee_id" = e."employee_id" AND x."week" = e."week" + 1);
UPDATE "employee_ramp_assignments" SET "ramp_start_week" = "ramp_start_week" + 1
 WHERE "ramp_start_week" >= '2026-05-30' AND extract(dow from "ramp_start_week") = 6;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '814f1144abffb0b5f7c7fdcd8cd3150b0ad890bffb83fa209b754fab0fa8f844', 1789610605364 -- 0055_sunday_weeks
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '814f1144abffb0b5f7c7fdcd8cd3150b0ad890bffb83fa209b754fab0fa8f844');

commit;

-- Verify: every *_saturday_keys_left column 0 (a non-zero count is a week
-- already re-imported on the new grid before this ran — see the runbook),
-- ledger_bad_span 0, legacy_week_extended 1 if the week of 23 May 2026 was
-- ever imported (else 0), tracked 1.
select
  (select count(*) from weekly_metric_results where week_start >= '2026-05-30' and extract(dow from week_start) = 6) as ledger_saturday_keys_left,
  (select count(*) from weekly_metric_results where week_start >= '2026-05-31' and week_end <> week_start + 6) as ledger_bad_span,
  (select count(*) from weekly_metric_results where week_start = '2026-05-23' and week_end = '2026-05-30') as legacy_week_extended,
  (select count(*) from performance_issues where (opened_week >= '2026-05-30' and extract(dow from opened_week) = 6)
      or (last_evaluated_week >= '2026-05-30' and extract(dow from last_evaluated_week) = 6)
      or (resolved_week >= '2026-05-30' and extract(dow from resolved_week) = 6)) as issues_saturday_keys_left,
  (select count(*) from weekly_issue_history where week >= '2026-05-30' and extract(dow from week) = 6) as history_saturday_keys_left,
  (select count(*) from rca_notes where week >= '2026-05-30' and extract(dow from week) = 6) as rca_saturday_keys_left,
  (select count(*) from ews_assessments where week >= '2026-05-30' and extract(dow from week) = 6) as ews_saturday_keys_left,
  (select count(*) from employee_ramp_assignments where ramp_start_week >= '2026-05-30' and extract(dow from ramp_start_week) = 6) as ramp_saturday_keys_left,
  (select count(*) from drizzle.__drizzle_migrations where hash = '814f1144abffb0b5f7c7fdcd8cd3150b0ad890bffb83fa209b754fab0fa8f844') as tracked;

-- The weekly ledger by week, newest first: every week_start from 31 May
-- 2026 should now be a Sunday (dow 0) with a seven-day span.
select week_start, week_end, extract(dow from week_start)::int as dow, week_end - week_start + 1 as days, count(*) as rows_in_week
from weekly_metric_results
where week_start >= '2026-05-16'
group by 1, 2 order by 1 desc;
