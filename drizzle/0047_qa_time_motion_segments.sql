-- Custom SQL migration file, put your code below! --

-- The Phone form's Time & Motion segments follow the call flow the action
-- item's study times (DEFAULT_SEGMENTS in src/lib/time-motion/engine.ts),
-- so one call is timed the same way wherever it is timed. Past audits keep
-- the segments they were filed with: each audit row freezes its own.
update public.qa_forms
   set definition = definition || jsonb_build_object('timeMotion', jsonb_build_object('segments', '[{"label":"Opening & Verification","baseline":30},{"label":"Identify the Concern","baseline":45},{"label":"Investigation","baseline":120},{"label":"Delivery of Findings","baseline":75},{"label":"Closing","baseline":30}]'::jsonb)),
       updated_at = now()
 where key = 'phone'
   and definition->'timeMotion'->'segments' is distinct from '[{"label":"Opening & Verification","baseline":30},{"label":"Identify the Concern","baseline":45},{"label":"Investigation","baseline":120},{"label":"Delivery of Findings","baseline":75},{"label":"Closing","baseline":30}]'::jsonb;
