-- One paste, one transaction: apply migration 0047 (the Phone form's Time
-- & Motion segments now match the action item's call study) and record it
-- in drizzle's tracker, the way this project applies migrations to
-- production (the Supabase SQL editor as postgres). Safe to run twice: the
-- form is updated only while its segments differ, the tracker insert is
-- guarded. No schema change, nothing to re-grant.

begin;

update public.qa_forms
   set definition = definition || jsonb_build_object('timeMotion', jsonb_build_object('segments', '[{"label":"Opening & Verification","baseline":30},{"label":"Identify the Concern","baseline":45},{"label":"Investigation","baseline":120},{"label":"Delivery of Findings","baseline":75},{"label":"Closing","baseline":30}]'::jsonb)),
       updated_at = now()
 where key = 'phone'
   and definition->'timeMotion'->'segments' is distinct from '[{"label":"Opening & Verification","baseline":30},{"label":"Identify the Concern","baseline":45},{"label":"Investigation","baseline":120},{"label":"Delivery of Findings","baseline":75},{"label":"Closing","baseline":30}]'::jsonb;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '9bb0b9269aee0a21c3173ebb20ac047b74c8930a5991442ef968e50b0a7fc8c3', 1789278836111 -- 0047_qa_time_motion_segments
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '9bb0b9269aee0a21c3173ebb20ac047b74c8930a5991442ef968e50b0a7fc8c3');

commit;

-- Verify: expect "Opening & Verification" and 5.
select definition->'timeMotion'->'segments'->0->>'label' as first_segment,
       jsonb_array_length(definition->'timeMotion'->'segments') as segments
  from public.qa_forms where key = 'phone';
