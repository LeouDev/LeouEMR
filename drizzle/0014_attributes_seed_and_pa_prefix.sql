-- Custom SQL migration file, put your code below! --

-- Attributes per audit, per skill. Used only as the DPO denominator: each
-- quality record contributes (its own skill's attributes x its audits), so
-- an employee audited on several skills is scored against the right mix.
update public.skill_references set attributes_per_audit = 25 where code = 'fax';
update public.skill_references set attributes_per_audit = 28 where code = 'partd_phones';
update public.skill_references set attributes_per_audit = 28 where code = 'gen_phones';
update public.skill_references set attributes_per_audit = 28 where code = 'uhc_west';
update public.skill_references set attributes_per_audit = 25 where code = 'glp_1';
update public.skill_references set attributes_per_audit = 14 where code = 'outreach';
update public.skill_references set attributes_per_audit = 8  where code = 'edits';
update public.skill_references set attributes_per_audit = 34 where code = 'ocn';
-- Everything else keeps the column default of 23.

-- Action items are identified as PA-YYYY-NNNNNN rather than AI-.
update public.action_items
   set code = 'PA-' || substring(code from 4)
 where code like 'AI-%';
