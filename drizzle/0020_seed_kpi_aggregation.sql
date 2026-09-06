-- Custom SQL migration file, put your code below! --

-- How each KPI's daily facts re-aggregate into a value for a reporting
-- period. These are not interchangeable: a rate must re-divide its totals
-- rather than average its weekly values, a count sums, and AHT inverts.
update public.kpi_definitions set aggregation = 'ratio_pct'       where code in ('QUALITY', 'ATTENDANCE');
update public.kpi_definitions set aggregation = 'ratio'           where code in ('NPS', 'CPH');
update public.kpi_definitions set aggregation = 'inverse_seconds' where code = 'AHT';
update public.kpi_definitions set aggregation = 'sum'             where code = 'CRITICAL_ERRORS';

-- PAR, DPU, DPO and MBO are computed from the per-skill fact tables rather
-- than from a single numerator and denominator.
update public.kpi_definitions set aggregation = 'derived'
 where code in ('PRODUCTION_RATE', 'DPU', 'DPO', 'MBO');

alter table public.metric_facts  enable row level security;
alter table public.skill_facts   enable row level security;
alter table public.quality_facts enable row level security;
