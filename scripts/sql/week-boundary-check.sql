-- Which seven days does a "WE <Friday>" week label really cover: Saturday
-- to Friday (how the app reads a week-ending Friday) or Sunday to
-- Saturday? Read-only. The weekly ledger and the daily facts are built
-- from the same imported rows, so for each weekly AHT/CPH row the daily
-- sample counts summed over the RIGHT seven days equal the weekly sample
-- count, and summed over the wrong seven they miss the boundary day.
with weekly as (
  select r.employee_id, r.kpi_id, r.week_start, r.week_end, r.sample_size
  from weekly_metric_results r
  join kpi_definitions k on k.id = r.kpi_id
  where k.code in ('AHT', 'CPH')
    and r.week_start >= date '2026-07-01'
    and r.sample_size is not null
),
sums as (
  select w.*,
    (select coalesce(sum(f.sample_size), 0) from metric_facts f
      where f.employee_id = w.employee_id and f.kpi_id = w.kpi_id
        and f.fact_date between w.week_start and w.week_end) as sat_to_fri,
    (select coalesce(sum(f.sample_size), 0) from metric_facts f
      where f.employee_id = w.employee_id and f.kpi_id = w.kpi_id
        and f.fact_date between w.week_start + 1 and w.week_end + 1) as sun_to_sat
  from weekly w
)
select count(*) as weekly_rows,
       count(*) filter (where sat_to_fri = sample_size) as matches_sat_to_fri,
       count(*) filter (where sun_to_sat = sample_size) as matches_sun_to_sat,
       count(*) filter (where sat_to_fri <> sample_size and sun_to_sat <> sample_size) as matches_neither
from sums;

-- And plainly: how much production lands on each weekday since July.
select to_char(fact_date, 'Dy') as weekday,
       sum(cases)::int as cases,
       round(sum(hours)::numeric, 1) as hours,
       count(distinct employee_id) as people,
       count(distinct fact_date) as days
from skill_facts
where fact_date >= date '2026-07-01'
group by 1, extract(dow from fact_date)
order by extract(dow from fact_date);
