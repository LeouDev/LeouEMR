-- One paste, one transaction: apply migration 0046 (Trainer and SME roles)
-- and record it in drizzle's tracker, the way this project applies
-- migrations to production (the Supabase SQL editor as postgres).
-- Safe to run twice: the enum values and the column are added only if
-- missing, the tracker insert is guarded. Nothing to re-grant: no new
-- table, and the app role already reads and writes qa_audits.
-- (Adding enum values inside a transaction needs Postgres 12 or later,
-- which every Supabase project runs; the new values are not used until
-- after the commit.)

begin;

ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'trainer';
--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'sme';
--> statement-breakpoint
-- An audit filed by a trainer or SME does not count toward the team
-- lead's two-per-agent requirement; only the supervisor's own audits do.
ALTER TABLE "qa_audits" ADD COLUMN IF NOT EXISTS "counts_for_requirement" boolean DEFAULT true NOT NULL;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '9bcdf3aa6c4e70ed3b354e67b8d75693d267c8ef57be735fb190c49e43931d31', 1789276158560 -- 0046_support_roles
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '9bcdf3aa6c4e70ed3b354e67b8d75693d267c8ef57be735fb190c49e43931d31');

commit;

-- Verify: expect 2 and 1.
select (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'user_role' and e.enumlabel in ('trainer', 'sme')) as enum_values_present,
       (select count(*) from information_schema.columns
         where table_name = 'qa_audits' and column_name = 'counts_for_requirement') as column_present;
