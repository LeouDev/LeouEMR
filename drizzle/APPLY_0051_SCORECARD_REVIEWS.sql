-- One paste, one transaction: apply migration 0051 (the scorecard's
-- review and acknowledgement stamps), give the app role its policy on
-- the new table (what re-running scripts/sql/app-role.sql would do), and
-- record the migration in drizzle's tracker, the way this project applies
-- migrations to production (the Supabase SQL editor as postgres). Safe to
-- run twice: every statement is guarded, and the tracker insert is too.
-- Run APPLY_0050_SCORECARD_INPUTS.sql first.

begin;

-- The two stamps on a month's scorecard: the team leader's review (from ten
-- days after the month ends) and, after it, the agent's acknowledgement.
-- The score at review is kept so a later re-import that moves the card can
-- say "changed since review".
CREATE TABLE IF NOT EXISTS "scorecard_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" date NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_score" numeric,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scorecard_reviews_employee_id_employees_id_fk') then
    ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_employee_id_employees_id_fk"
      FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scorecard_reviews_reviewed_by_users_id_fk') then
    ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_reviewed_by_users_id_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scorecard_reviews_acknowledged_by_users_id_fk') then
    ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_acknowledged_by_users_id_fk"
      FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS "scorecard_reviews_employee_month_idx"
  ON "scorecard_reviews" USING btree ("employee_id","month");

ALTER TABLE "scorecard_reviews" ENABLE ROW LEVEL SECURITY;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scorecard_reviews' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.scorecard_reviews for all to emr_app using (true) with check (true);
  end if;
end $$;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '3d5b8df5dddfe62d4fe2371e2703f24201e03f6022ca4cb5e1753f902f9d34f1', 1789355254028 -- 0051_scorecard_reviews
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '3d5b8df5dddfe62d4fe2371e2703f24201e03f6022ca4cb5e1753f902f9d34f1');

commit;

-- Verify: 1 row each.
select
  (select count(*) from information_schema.tables where table_name = 'scorecard_reviews') as table_present,
  (select count(*) from pg_policies where tablename = 'scorecard_reviews' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = '3d5b8df5dddfe62d4fe2371e2703f24201e03f6022ca4cb5e1753f902f9d34f1') as tracked;
