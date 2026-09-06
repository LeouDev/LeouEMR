-- Custom SQL migration file, put your code below! --

-- PAR/MBO skill reference table. Targets and R1-R5 ratio thresholds as
-- supplied by the business. Thresholds are decimal ratios (1.2727 = 127.27%).
-- `target` is editable in the app; the rating thresholds are locked.
--
-- The five lower-is-better skills (ratio = target/actual) match the
-- LOWER_IS_BETTER_SKILLS list in the existing MBO2 app.

insert into public.skill_references
  (code, name, target, lower_is_better, r5, r4, r3, r2, r1, sort_order)
values
  ('ocn',                      'OCN',                      14.5,  false, 1.5385, 1.2222, 1.00, 0.6667, 0,  1),
  ('outreach',                 'Outreach',                 9.5,   false, 1.5000, 1.2317, 1.00, 0.7779, 0,  2),
  ('b_vs_d',                   'B vs D',                   6,     false, 1.4500, 1.2601, 1.00, 0.7500, 0,  3),
  ('edits',                    'EDITS',                    8,     false, 1.6663, 1.4326, 1.00, 0.6838, 0,  4),
  ('cs_pharma_admin',          'C&S Pharma Admin',         8,     false, 1.5862, 1.3000, 1.00, 0.7138, 0,  5),
  ('cs_appeals_verification',  'C&S Appeals Verification', 9,     false, 1.4178, 1.2356, 1.00, 0.7733, 0,  6),
  ('av_commercial',            'AV Commercial',            9,     false, 1.4178, 1.2356, 1.00, 0.7733, 0,  7),
  ('clinical_appeals',         'Clinical Appeals',         5.30,  false, 1.5094, 1.3113, 1.00, 0.8622, 0,  8),
  ('am_cancellation_wb',       'A&M - Cancellation WB',    9,     false, 2.6000, 1.9990, 1.00, 0.8000, 0,  9),
  ('am_cancellation_sp',       'A&M - Cancellation SP',    16,    false, 1.6667, 1.4158, 1.00, 0.7500, 0, 10),
  ('am_live',                  'A&M - Live',               25,    false, 1.6667, 1.4158, 1.00, 0.7500, 0, 11),
  ('outreach_denial',          'Outreach Denial',          10.50, false, 1.3800, 1.1900, 1.00, 0.7500, 0, 12),
  ('obd_phone',                'OBD Phone',                435,   true,  1.3587, 1.1921, 1.00, 0.9239, 0, 13),
  ('partd_phones',             'PartD_Phones',             500,   true,  1.1788, 1.0892, 1.00, 0.8500, 0, 14),
  ('gen_phones',               'Gen_Phones',               515,   true,  1.2675, 1.0775, 1.00, 0.9349, 0, 15),
  ('fax',                      'Fax',                      11,    false, 1.2727, 1.1682, 1.00, 0.8955, 0, 16),
  ('glp_1',                    'GLP_1',                    15,    false, 1.2733, 1.1680, 1.00, 0.8950, 0, 17),
  ('uhc_west',                 'UHC_west',                 485,   true,  1.1788, 1.0891, 1.00, 0.8549, 0, 18),
  ('clinical_appeals_phone',   'Clinical Appeals Phone',   485,   true,  1.1788, 1.0891, 1.00, 0.8549, 0, 19),
  ('misroutes',                'Misroutes',                1.97,  false, 1.2741, 1.1675, 1.00, 0.8934, 0, 20)
on conflict (code) do nothing;
