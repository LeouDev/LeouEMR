-- Custom SQL migration file, put your code below! --

-- PAR/MBO KPIs. These are derived rather than measured: PRODUCTION_RATE is
-- the hours-weighted 1.00-5.00 rating computed from the skill reference
-- curves, and DPU is the share of audits with a perfect result.
--
-- The 2.99 pass line matches the existing MBO2 app's isPass() gate; the DPU
-- line matches its 95% quality gate. Decomposed into separate KPIs rather
-- than one AND-gate so each is tracked independently (spec section 6).
insert into public.kpi_definitions
  (code, name, type, direction, target, warning_threshold, failure_threshold)
values
  ('PRODUCTION_RATE', 'Production Rate (PAR)', 'score',      'higher_is_better', 3.00, 3.00, 2.99),
  ('DPU',             'Quality DPU',           'percentage', 'higher_is_better', 95,   95,   95)
on conflict (code) do nothing;
