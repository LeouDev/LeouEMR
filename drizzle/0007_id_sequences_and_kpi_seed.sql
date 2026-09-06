-- Custom SQL migration file, put your code below! --

-- Stable, human-facing identifiers (spec section 30): AI-2026-000123 style.
-- Sequences rather than counting rows, so concurrent imports can't collide
-- on the same number.
create sequence if not exists performance_issue_seq;
create sequence if not exists action_item_seq;

alter table public.skill_references enable row level security;

-- ---------------------------------------------------------------------------
-- KPI definitions.
--
-- CPH and AHT carry their own per-employee targets in the source data
-- (CPHTarget/AHTTarget), so the values here are only the fallback used when
-- a row arrives without one — the per-row target always wins.
--
-- Quality/Attendance/NPS have no thresholds anywhere in the source file.
-- The values below are PLACEHOLDERS pending confirmation from the business
-- and are editable from the KPI configuration screen.
-- ---------------------------------------------------------------------------
insert into public.kpi_definitions
  (code, name, type, direction, target, warning_threshold, failure_threshold)
values
  ('QUALITY',         'Quality',          'percentage', 'higher_is_better', 95,  95,  90),
  ('ATTENDANCE',      'Attendance',       'percentage', 'higher_is_better', 95,  95,  90),
  ('NPS',             'NPS',              'score',      'higher_is_better', 70,  70,  50),
  ('CPH',             'Cases Per Hour',   'number',     'higher_is_better', 11,  11,  11),
  ('AHT',             'Average Handle Time', 'number',  'lower_is_better',  750, 750, 750),
  ('CRITICAL_ERRORS', 'Critical Errors',  'number',     'lower_is_better',  0,   0,   0)
on conflict (code) do nothing;
