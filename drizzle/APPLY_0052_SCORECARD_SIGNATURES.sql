-- One paste, one transaction: apply migration 0052 (drawn signatures on
-- the scorecard stamps) and record it in drizzle's tracker, the way this
-- project applies migrations to production (the Supabase SQL editor as
-- postgres). Safe to run twice: both columns are added only if missing and
-- the tracker insert is guarded. Run after APPLY_0051_SCORECARD_REVIEWS.sql.

begin;

-- The team leader's and the agent's drawn signatures, kept as strokes
-- (a few kilobytes each) and drawn back on the card and the printed sheet.
ALTER TABLE "scorecard_reviews" ADD COLUMN IF NOT EXISTS "reviewed_signature" jsonb;
ALTER TABLE "scorecard_reviews" ADD COLUMN IF NOT EXISTS "acknowledged_signature" jsonb;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '64398ba32851633d063b561fd15aacffe7916ed3ce028152d645a0a20cd3dfe6', 1789368760310 -- 0052_scorecard_signatures
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '64398ba32851633d063b561fd15aacffe7916ed3ce028152d645a0a20cd3dfe6');

commit;

-- Verify: 2 and 1.
select
  (select count(*) from information_schema.columns where table_name = 'scorecard_reviews' and column_name in ('reviewed_signature', 'acknowledged_signature')) as columns_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = '64398ba32851633d063b561fd15aacffe7916ed3ce028152d645a0a20cd3dfe6') as tracked;
