-- Custom SQL migration file, put your code below! --

-- The export names skills differently from the reference table. Without
-- these, 37% of production hours would be silently dropped from PAR
-- ratings, because an unmatched skill contributes nothing.
insert into public.skill_aliases (source_label, skill_reference_id)
select v.source_label, s.id
from (values
  -- Naming variants of skills that already exist.
  ('General Phone',        'gen_phones'),
  ('Part D Phone',         'partd_phones'),
  ('UHCWest Phone',        'uhc_west'),
  ('Outcome Notification', 'ocn'),
  -- Confirmed by the business.
  ('MPA Outreach',         'outreach'),
  ('UHCWest Fax',          'fax')
  -- "OBD Special Project" is deliberately left unmapped for now: a special
  -- project may not carry the same expectations as OBD Phone, so its hours
  -- stay out of PAR ratings until it is configured as its own skill. The
  -- import reports it under unmatchedSkills so it stays visible.
) as v(source_label, skill_code)
join public.skill_references s on s.code = v.skill_code
on conflict (source_label) do nothing;
