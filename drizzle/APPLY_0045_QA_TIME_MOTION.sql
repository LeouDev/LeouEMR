-- One paste, one transaction: apply migration 0045 (Time & Motion on Phone
-- audits) and record it in drizzle's tracker, the way this project applies
-- migrations to production (the Supabase SQL editor as postgres).
-- Safe to run twice: the column is added only if missing, the form is
-- updated only while it lacks the segments, the tracker insert is guarded.
-- Nothing to re-grant.

begin;

ALTER TABLE "qa_audits" ADD COLUMN IF NOT EXISTS "time_motion" jsonb;
--> statement-breakpoint
-- The Phone form logs Time & Motion: five call segments with default
-- baselines the evaluator may override per audit (src/lib/quality/forms.ts).
update public.qa_forms
   set definition = definition || '{"timeMotion":{"segments":[{"label":"Greeting / verification","baseline":30},{"label":"Account lookup","baseline":60},{"label":"Issue discussion","baseline":240},{"label":"Resolution / hold","baseline":90},{"label":"Wrap-up","baseline":60}]}}'::jsonb,
       updated_at = now()
 where key = 'phone' and not (definition ? 'timeMotion');

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '72cc99838e4e0483e740107e7b59bd21bfb635f2eb1506823be1c520f4822bde', 1789272144590 -- 0045_qa_time_motion
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '72cc99838e4e0483e740107e7b59bd21bfb635f2eb1506823be1c520f4822bde');

commit;

-- Verify: expect 1 and 5.
select (select count(*) from information_schema.columns where table_name = 'qa_audits' and column_name = 'time_motion') as column_present,
       jsonb_array_length(definition->'timeMotion'->'segments') as phone_segments
  from public.qa_forms where key = 'phone';
