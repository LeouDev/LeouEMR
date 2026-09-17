-- The month target the app scores every ramping agent's production
-- against, and the figure it produces — read-only, one row per agent and
-- ramping skill. Change the month in the first line.
--
-- The rule (src/lib/ramp/effective-target.ts): the plain average of each
-- WORKED reporting week's target — the ramp stage's target while the ramp
-- runs (two nesting weeks, then Week 1 through Week 8), the skill's steady target once
-- it is over — where a week counts when any hours or cases were logged in
-- it. Weeks not yet worked count for nothing, so a running month judges
-- only the weeks it has; at month end this is the whole month's average.
-- Reporting weeks run Saturday to Friday. Every label a skill goes by
-- (code, name, aliases) folds into that skill.
with month as (
  select date '2026-09-01' as first_day,
         (date '2026-09-01' + interval '1 month' - interval '1 day')::date as last_day
),
labels as (
  select r.id as skill_reference_id, regexp_replace(lower(r.code), '[^a-z0-9]', '', 'g') as label from skill_references r
  union
  select r.id, regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g') from skill_references r
  union
  select a.skill_reference_id, regexp_replace(lower(a.source_label), '[^a-z0-9]', '', 'g') from skill_aliases a
),
weeks as (
  select f.employee_id, l.skill_reference_id,
         (f.fact_date - ((extract(dow from f.fact_date)::int + 1) % 7))::date as week_start,
         sum(f.hours) as hours, sum(f.cases) as cases
  from skill_facts f
  cross join month m
  join labels l on l.label = regexp_replace(lower(f.skill_label), '[^a-z0-9]', '', 'g')
  where f.fact_date between m.first_day and m.last_day
  group by 1, 2, 3
),
worked as (
  select a.employee_id, a.skill_reference_id, a.ramp_start_week, w.week_start, w.hours, w.cases,
         floor((w.week_start - a.ramp_start_week) / 7.0)::int as stage
  from employee_ramp_assignments a
  join weeks w on w.employee_id = a.employee_id and w.skill_reference_id = a.skill_reference_id
  where w.hours > 0 or w.cases > 0
),
targets as (
  select x.*, r.name as skill, r.target as steady, r.lower_is_better, r.metric, r.r2, r.r3, r.r4, r.r5,
         case when x.stage between 0 and 9 then s.target end as stage_target,
         coalesce(case when x.stage between 0 and 9 then s.target end, r.target) as week_target
  from worked x
  join skill_references r on r.id = x.skill_reference_id
  left join skill_ramp_schedules s on s.skill_reference_id = x.skill_reference_id and s.stage = x.stage
),
per_skill as (
  select e.name as agent, e.eid, t.skill, t.ramp_start_week, t.lower_is_better, t.metric, t.steady, t.r2, t.r3, t.r4, t.r5,
         count(*) as weeks_worked,
         string_agg(
           to_char(t.week_start, 'Mon DD') || ' → ' || round(t.week_target::numeric, 2)
             || case when t.stage_target is null then ' (steady)'
                     when t.stage < 2 then ' (nesting ' || (t.stage + 1) || ')'
                     else ' (week ' || (t.stage - 1) || ')' end,
           ', ' order by t.week_start) as weeks,
         avg(t.week_target) as month_target,
         case when t.metric = 'case_rate' then null
              when t.lower_is_better then sum(t.hours) / nullif(sum(t.cases), 0) * 3600
              else sum(t.cases) / nullif(sum(t.hours), 0) end as month_actual
  from targets t
  join employees e on e.id = t.employee_id
  group by e.name, e.eid, t.skill, t.ramp_start_week, t.lower_is_better, t.metric, t.steady, t.r2, t.r3, t.r4, t.r5
),
rated as (
  select p.*,
         case when p.month_actual is null or p.month_actual = 0 then null
              when p.lower_is_better then p.month_target / p.month_actual
              else p.month_actual / p.month_target end as ratio
  from per_skill p
)
select agent, eid, skill, ramp_start_week, weeks_worked, weeks,
       round(month_target::numeric, 2) as month_target,
       round(steady::numeric, 2) as steady_target,
       round(month_actual::numeric, 2) as month_actual,
       round(ratio::numeric, 3) as ratio,
       -- The skill's own rating on the R1–R5 curve (step below target,
       -- interpolated above). PAR on screen is this blended by hours
       -- across every skill the agent worked.
       round(case when ratio is null then null
                  when ratio >= r5 then 5
                  when ratio >= r4 then 4 + (ratio - r4) / (r5 - r4)
                  when ratio >= r3 then 3 + (ratio - r3) / (r4 - r3)
                  when ratio >= r2 then 2
                  else 1 end::numeric, 2) as skill_rating
from rated
order by agent, skill;
