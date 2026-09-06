-- Custom SQL migration file, put your code below! --

-- The ten warning signs from the existing EWS app, now configuration rather
-- than a hardcoded JS array. These are supervisor judgements — none of them
-- can be derived from the weekly performance data.
insert into public.ews_indicators (code, label, sort_order) values
  ('tardy',    'Frequent tardiness',                 1),
  ('absent',   'Increased absences',                 2),
  ('lowprod',  'Low productivity',                   3),
  ('diseng',   'Disengagement in team huddles',      4),
  ('jobhunt',  'Job hunting signals',                5),
  ('conflict', 'Conflicts with teammates',           6),
  ('qadrop',   'Decline in QA / NPS scores',         7),
  ('noinit',   'Reduced initiative',                 8),
  ('loa',      'Requesting LOA / leaves',            9),
  ('withdraw', 'Withdrawal from social activities', 10)
on conflict (code) do nothing;

-- Consistent with the fail-closed baseline from 0001.
alter table public.ews_indicators enable row level security;
alter table public.ews_assessments enable row level security;
