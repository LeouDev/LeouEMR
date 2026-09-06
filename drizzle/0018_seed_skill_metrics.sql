-- Custom SQL migration file, put your code below! --

-- Which formula produces each skill's measured value, taken from the source
-- workbook's own Calculated Field definitions and confirmed against the MBO
-- calculation template: every skill matched its assigned formula on 100% of
-- employees.
--
--   case_rate = 'Prod Weight' / CASESCOMPLETED      (no hours involved)
--   aht       = (PRODUCTIVITYHOUR / CASESCOMPLETED) * 3600
--   cph       = CASESCOMPLETED / PRODUCTIVITYHOUR   (the default)

update public.skill_references
   set metric = 'case_rate'
 where code in ('fax', 'glp_1', 'cs_pharma_admin');

update public.skill_references
   set metric = 'aht'
 where code in ('gen_phones', 'partd_phones', 'obd_phone', 'uhc_west', 'clinical_appeals_phone');
