-- Custom SQL migration file, put your code below! --

-- Real thresholds supplied by the business, replacing the placeholders.
-- Target is also the pass line: below it fails. No warning band is set, so
-- these are pass/fail only until a caution zone is asked for.
update public.kpi_definitions
   set target = 95, failure_threshold = 95, warning_threshold = null
 where code = 'ATTENDANCE';

update public.kpi_definitions
   set target = 98, failure_threshold = 98, warning_threshold = null
 where code = 'QUALITY';

update public.kpi_definitions
   set target = 70, failure_threshold = 70, warning_threshold = null
 where code = 'NPS';

-- DPO joins DPU as a quality gate.
insert into public.kpi_definitions
  (code, name, type, direction, target, failure_threshold)
values
  ('DPO', 'Quality DPO', 'percentage', 'higher_is_better', 95, 95)
on conflict (code) do nothing;

-- MBO is the composite that decides pass/fail, matching the existing MBO2
-- app's gate: production rate >= 2.99 AND DPU >= 95% AND DPO >= 95%.
-- Stored as the share of gates met so it can be evaluated like any other
-- KPI; anything short of all of them fails.
insert into public.kpi_definitions
  (code, name, type, direction, target, failure_threshold)
values
  ('MBO', 'MBO Result', 'percentage', 'higher_is_better', 100, 100)
on conflict (code) do nothing;
