-- One paste, one transaction: apply migration 0053 (My Space, a leader's
-- personal daily board), give the app role its policy on the two new
-- tables (what re-running scripts/sql/app-role.sql would do), and record
-- the migration in drizzle's tracker, the way this project applies
-- migrations to production (the Supabase SQL editor as postgres). Safe to
-- run twice: every statement is guarded, and the tracker insert is too.
-- Run after APPLY_0052_SCORECARD_SIGNATURES.sql.

begin;

-- The four boxes on the board; an idea has no completion state.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'my_space_box') then
    CREATE TYPE "public"."my_space_box" AS ENUM('todos', 'decisions', 'ideas', 'letgo');
  end if;
end $$;

-- A saved day: the four boxes frozen as they stood when "Save day" was
-- pressed, one per account per Manila calendar day.
CREATE TABLE IF NOT EXISTS "my_space_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"boxes" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- What is on someone's board right now; private to the account.
CREATE TABLE IF NOT EXISTS "my_space_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"box" "my_space_box" NOT NULL,
	"text" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'my_space_days_user_id_users_id_fk') then
    ALTER TABLE "my_space_days" ADD CONSTRAINT "my_space_days_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'my_space_items_user_id_users_id_fk') then
    ALTER TABLE "my_space_items" ADD CONSTRAINT "my_space_items_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS "my_space_days_user_day_idx" ON "my_space_days" USING btree ("user_id","day");
CREATE INDEX IF NOT EXISTS "my_space_items_user_idx" ON "my_space_items" USING btree ("user_id");

ALTER TABLE "my_space_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "my_space_items" ENABLE ROW LEVEL SECURITY;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'my_space_days' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.my_space_days for all to emr_app using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'my_space_items' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.my_space_items for all to emr_app using (true) with check (true);
  end if;
end $$;

insert into drizzle.__drizzle_migrations (hash, created_at)
select 'bd509ce0a5a86fde5e4ec4eb1e324e427af14b55e7facede51c803872bb8673c', 1789448848915 -- 0053_my_space
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = 'bd509ce0a5a86fde5e4ec4eb1e324e427af14b55e7facede51c803872bb8673c');

commit;

-- Verify: 2, 2, 1 and 1.
select
  (select count(*) from information_schema.tables where table_name in ('my_space_days', 'my_space_items')) as tables_present,
  (select count(*) from pg_policies where tablename in ('my_space_days', 'my_space_items') and policyname = 'emr_app_full_access') as policies_present,
  (select count(*) from pg_type where typname = 'my_space_box') as type_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = 'bd509ce0a5a86fde5e4ec4eb1e324e427af14b55e7facede51c803872bb8673c') as tracked;
