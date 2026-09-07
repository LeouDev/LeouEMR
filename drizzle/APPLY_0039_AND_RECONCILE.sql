-- One paste, one transaction: catch drizzle's tracker up and apply 0039.
--
-- Replaces the two-step dance of RECONCILE_TRACKER.sql followed by
-- `npm run db:migrate`, where running the migrate half first makes it try to
-- create tables that already exist and abort — leaving nothing applied.
--
-- Run this in the Supabase SQL editor. It is safe to run twice: the inserts
-- are guarded, and SET NOT NULL on an already-NOT NULL column is a no-op.
--
-- Afterwards `npm run db:migrate` will report nothing to apply, and
-- `npm run db:generate` nothing to generate. Delete this file and
-- RECONCILE_TRACKER.sql once it has run.

begin;

-- 1. Record the five migrations that were applied by hand and never tracked.
--    Hashes are the sha256 of each file's contents, the same key drizzle uses
--    for the 33 rows already present.
insert into drizzle.__drizzle_migrations (hash, created_at) values
  ('5063fbe720dcc857734e116dfcd7d31bfd74bbed0761a9bb22deb3a5742edd69', 1788708114857), -- 0034_employee_assignments
  ('f8360d82ac1e110843790c3a86db3161e935771c68ac843501a20d39e301e5bf', 1788708115857), -- 0035_pto_code_sequence
  ('6b8fe974e1a756233651c950a758e7ffd2ac523085f8cc20b356fd688dd52626', 1788708116857), -- 0036_scoping_indexes
  ('faf7d2cc29072e7e9cb8d8ba77b771251d76428aa498bf13af6dbc9a02fe8bc6', 1788711077262), -- 0037_time_motion_studies
  ('35d6b9debf46e9639c5e296c3ba4a349003085d6aab039dd1a7a20a3e761893e', 1788720995488)  -- 0038_ramp_schedules
on conflict do nothing;

-- 2. Apply 0039 itself: every performance row must name the import that
--    produced it. Verified beforehand to hold no nulls across all six tables.
alter table "weekly_metric_results" alter column "source_import_id" set not null;
alter table "metric_facts"          alter column "source_import_id" set not null;
alter table "skill_facts"           alter column "source_import_id" set not null;
alter table "quality_facts"         alter column "source_import_id" set not null;
alter table "nps_facts"             alter column "source_import_id" set not null;
alter table "employee_assignments"  alter column "source_import_id" set not null;

-- 3. Record 0039 too, so drizzle knows it is done.
insert into drizzle.__drizzle_migrations (hash, created_at) values
  ('c7fe6fc5250569d81fb8635ee32ac779ea6a9e7e0ad12c8e5287327628fe6fc5', 1788784213106) -- 0039_require_source_import
on conflict do nothing;

commit;

-- Verification. Expect 39, and six rows all reading NO.
select count(*) as recorded_migrations from drizzle.__drizzle_migrations;

select table_name, is_nullable
from information_schema.columns
where column_name = 'source_import_id' and table_schema = 'public'
order by table_name;
