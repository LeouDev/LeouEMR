-- One paste, one transaction: apply migration 0049 (profile pictures),
-- give the app role its policy on the new table (what re-running
-- scripts/sql/app-role.sql would do), and record the migration in
-- drizzle's tracker, the way this project applies migrations to
-- production (the Supabase SQL editor as postgres). Safe to run twice:
-- the table is created only if missing, the policy only if absent, the
-- tracker insert is guarded.

begin;

-- A person's own profile picture, uploaded from the profile panel: base64
-- of a 256px image the browser resized, served back by /profile/avatar.
-- Its own table, not a column on users, which is read on every request.
CREATE TABLE IF NOT EXISTS "user_avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"content_type" text NOT NULL,
	"image" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- Fail-closed like every other table: RLS on, reachable only through the
-- app role's own policy (scripts/sql/app-role.sql).
ALTER TABLE "user_avatars" ENABLE ROW LEVEL SECURITY;

-- The app role reads and writes the new table through row-level security,
-- like every other public table.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_avatars' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.user_avatars for all to emr_app using (true) with check (true);
  end if;
end $$;

insert into drizzle.__drizzle_migrations (hash, created_at)
select 'cd45d7fd3312606643be04caf4b28d94728e0e85b1a09fef772b79a9a092c060', 1789281218698 -- 0049_user_avatars
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = 'cd45d7fd3312606643be04caf4b28d94728e0e85b1a09fef772b79a9a092c060');

commit;

-- Verify: expect 1 and 1.
select (select count(*) from information_schema.tables where table_name = 'user_avatars') as table_present,
       (select count(*) from pg_policies where tablename = 'user_avatars' and policyname = 'emr_app_full_access') as policy_present;
