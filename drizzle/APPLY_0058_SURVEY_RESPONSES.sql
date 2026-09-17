-- One paste, one transaction: apply migration 0058 (the post-login survey's
-- responses), give the app role its policy on the new table (what
-- re-running scripts/sql/app-role.sql would do), and record the migration in
-- drizzle's tracker, the way this project applies migrations to production
-- (the Supabase SQL editor as postgres). Safe to run twice: every statement
-- is guarded, and the tracker insert is too.
--
-- RUN THIS BEFORE THE GATE OPENS. The survey blocks the app until a row
-- exists for the account, and `surveyDueFor` fails open on a read error — so
-- without this table nobody is asked and nobody is locked out, but nothing
-- can be filed either. The code is deployed first; this is what makes the
-- feature real.

begin;

-- One row per account, and the row's existence is the completion flag: the
-- survey shows until it is there and never again after. Deliberately not
-- `nps_facts` — that table is customer NPS about an agent, and it is scored,
-- ranked and opens action items. This is staff rating the website; writing
-- these scores there would move agents' KPI results on the strength of
-- feedback about a web page.
CREATE TABLE IF NOT EXISTS "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"q1_overall" integer NOT NULL,
	"q2_ease" integer NOT NULL,
	"q3_findability" integer NOT NULL,
	"q4_nps" integer NOT NULL,
	"q5_feedback" text NOT NULL,
	CONSTRAINT "survey_responses_user_id_unique" UNIQUE("user_id")
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_responses_user_id_users_id_fk') then
    ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  end if;
end $$;

--> statement-breakpoint
ALTER TABLE "survey_responses" ENABLE ROW LEVEL SECURITY;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'survey_responses' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.survey_responses for all to emr_app using (true) with check (true);
  end if;
end $$;

-- The deployed app reads and writes through the limited role; its default
-- privileges cover tables postgres creates later, and this makes the grant
-- explicit where the role exists. No-op where it does not.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'emr_app') then
    grant select, insert, update, delete on public.survey_responses to emr_app;
  end if;
end $$;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select 'bbb57330106494bb34d5a20dfe29ac44877961f0acb38594e5c7ec2364374aea', 1789681513090 -- 0058_survey_responses
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = 'bbb57330106494bb34d5a20dfe29ac44877961f0acb38594e5c7ec2364374aea');

commit;

-- Verify: expect 1, 1, 1, 1 and 0 responses so far.
select
  (select count(*) from information_schema.tables where table_name = 'survey_responses') as table_present,
  (select count(*) from pg_policies where tablename = 'survey_responses' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from pg_constraint where conname = 'survey_responses_user_id_unique') as one_per_account,
  (select count(*) from drizzle.__drizzle_migrations where hash = 'bbb57330106494bb34d5a20dfe29ac44877961f0acb38594e5c7ec2364374aea') as tracked,
  (select count(*) from public.survey_responses) as responses;
