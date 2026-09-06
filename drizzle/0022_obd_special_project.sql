-- Custom SQL migration file, put your code below! --

-- OBD Special Project becomes its own skill: cases per hour against a goal
-- of 11, as specified by the business. Until now it was deliberately
-- unmapped, so its 837 hours contributed nothing to PAR ratings.
--
-- ASSUMPTION: the business supplied the target but not the R1-R5 rating
-- curve, so this inherits OBD Phone's curve as the closest relative in the
-- same work family. The target and metric are confirmed; the curve shape
-- is not, and should be reviewed.
insert into public.skill_references
  (code, name, target, metric, lower_is_better, r5, r4, r3, r2, r1, attributes_per_audit, sort_order)
select 'obd_special_project', 'OBD Special Project', 11, 'cph', false,
       s.r5, s.r4, s.r3, s.r2, s.r1, 23, 21
from public.skill_references s
where s.code = 'obd_phone'
on conflict (code) do nothing;
