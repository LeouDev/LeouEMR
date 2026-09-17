-- Read-only checks around migration 0055 (reporting weeks Sunday to
-- Saturday from 31 May 2026). Section A before APPLY_0055_SUNDAY_WEEKS.sql,
-- section B after it and again after the re-imports. Nothing here writes.
-- The order of operations is in docs/sunday-week-recut.md.

-- ---------------------------------------------------------------------
-- A. BEFORE: what the migration will move, and anything it will leave.
-- ---------------------------------------------------------------------

-- A1. Week keys per table from 30 May 2026 on, by weekday. Expect every
-- key to be a Saturday ("to_move"); a Sunday key means that week was
-- already written on the new grid (the migration leaves the Saturday row
-- beside it — re-import that week afterwards); any other weekday is a
-- mislabeled week the migration leaves alone.
with keys as (
  select 'weekly_metric_results.week_start' as source, week_start as key from weekly_metric_results
  union all select 'performance_issues.opened_week', opened_week from performance_issues
  union all select 'performance_issues.last_evaluated_week', last_evaluated_week from performance_issues
  union all select 'performance_issues.resolved_week', resolved_week from performance_issues
  union all select 'weekly_issue_history.week', week from weekly_issue_history
  union all select 'rca_notes.week', week from rca_notes
  union all select 'ews_assessments.week', week from ews_assessments
  union all select 'employee_ramp_assignments.ramp_start_week', ramp_start_week from employee_ramp_assignments
)
select source,
       count(*) filter (where extract(dow from key) = 6) as to_move,
       count(*) filter (where extract(dow from key) = 0) as already_sunday,
       count(*) filter (where extract(dow from key) not in (0, 6)) as other_weekday,
       min(key) as earliest, max(key) as latest
from keys
where key >= '2026-05-30'
group by source order by source;

-- A2. The weekly ledger by week around the cut-over and at the newest
-- end, as stored today (Saturday starts, seven-day spans).
select week_start, week_end, extract(dow from week_start)::int as dow, week_end - week_start + 1 as days, count(*) as rows_in_week
from weekly_metric_results
where week_start >= '2026-05-16'
group by 1, 2 order by 1 desc;

-- A3. Ramp assignments and where each start week will land.
select e.name, e.eid, r.name as skill, a.ramp_start_week,
       case when a.ramp_start_week >= '2026-05-30' and extract(dow from a.ramp_start_week) = 6
            then a.ramp_start_week + 1 else a.ramp_start_week end as after_migration
from employee_ramp_assignments a
join employees e on e.id = a.employee_id
join skill_references r on r.id = a.skill_reference_id
order by e.name, r.name;

-- A4. Which workbooks to re-import: every import whose weeks include any
-- week from 23 May 2026 on (the extended legacy week takes its Saturday
-- 30 May rows from the file labelled WE 06/05/26). Oldest first.
select b.id, b.uploaded_at, b.file_name, b.row_counts->'weeks' as weeks
from import_batches b
where exists (
  select 1 from jsonb_array_elements_text(coalesce(b.row_counts->'weeks', '[]'::jsonb)) w
  where w::date >= '2026-05-23')
order by b.uploaded_at;

-- ---------------------------------------------------------------------
-- B. AFTER the migration (and again after the re-imports).
-- ---------------------------------------------------------------------

-- B1. No Saturday key from 30 May 2026 on should remain anywhere; every
-- ledger week from 31 May should be a Sunday with a seven-day span; the
-- week of 23 May, if it was ever imported, should end on 30 May
-- (legacy_week_extended counts that week's ledger rows, so any non-zero
-- number is the pass).
select
  (select count(*) from weekly_metric_results where week_start >= '2026-05-30' and extract(dow from week_start) = 6) as ledger_saturday_keys_left,
  (select count(*) from weekly_metric_results where week_start >= '2026-05-31' and (extract(dow from week_start) <> 0 or week_end <> week_start + 6)) as ledger_off_grid,
  (select count(*) from weekly_metric_results where week_start = '2026-05-23' and week_end = '2026-05-30') as legacy_week_extended,
  (select count(*) from performance_issues where (opened_week >= '2026-05-30' and extract(dow from opened_week) = 6)
      or (last_evaluated_week >= '2026-05-30' and extract(dow from last_evaluated_week) = 6)
      or (resolved_week >= '2026-05-30' and extract(dow from resolved_week) = 6)) as issues_saturday_keys_left,
  (select count(*) from weekly_issue_history where week >= '2026-05-30' and extract(dow from week) = 6) as history_saturday_keys_left,
  (select count(*) from rca_notes where week >= '2026-05-30' and extract(dow from week) = 6) as rca_saturday_keys_left,
  (select count(*) from ews_assessments where week >= '2026-05-30' and extract(dow from week) = 6) as ews_saturday_keys_left,
  (select count(*) from employee_ramp_assignments where ramp_start_week >= '2026-05-30' and extract(dow from ramp_start_week) = 6) as ramp_saturday_keys_left;

-- B2. After the re-imports: does each stored weekly AHT/CPH row agree with
-- its own week's daily facts? A re-imported week is re-summed from the
-- facts inside its Sunday-to-Saturday window, so "differs" should be 0
-- for every week that was re-imported and non-zero only for weeks still
-- waiting on their file.
with weekly as (
  select w.week_start, w.week_end, w.employee_id, w.kpi_id, w.actual_value, k.code, k.aggregation
  from weekly_metric_results w
  join kpi_definitions k on k.id = w.kpi_id
  where w.week_start >= '2026-05-23' and k.code in ('AHT', 'CPH')
),
facts as (
  select x.week_start, x.employee_id, x.kpi_id,
         sum(f.numerator) as num, sum(f.denominator) as den
  from weekly x
  join metric_facts f on f.employee_id = x.employee_id and f.kpi_id = x.kpi_id
                     and f.fact_date between x.week_start and x.week_end
  group by 1, 2, 3
)
select x.week_start,
       count(*) as rows_in_week,
       count(*) filter (where f.week_start is null) as no_facts,
       count(*) filter (where f.week_start is not null and abs(x.actual_value
         - case x.code when 'CPH' then f.num / nullif(f.den, 0) else f.den * 3600 / nullif(f.num, 0) end) > 0.01) as differs
from weekly x
left join facts f on f.week_start = x.week_start and f.employee_id = x.employee_id and f.kpi_id = x.kpi_id
group by 1 order by 1 desc;
