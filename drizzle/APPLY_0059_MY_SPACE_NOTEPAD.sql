-- One paste, one transaction: apply migration 0059 (My Space's notepad),
-- give the app role its policy on the new table (what re-running
-- scripts/sql/app-role.sql would do), and record the migration in drizzle's
-- tracker, the way this project applies migrations to production (the
-- Supabase SQL editor as postgres). Safe to run twice: every statement is
-- guarded, and the tracker insert is too.
--
-- Nothing breaks without this. The notepad is the only part of My Space that
-- reads this table, and its read fails soft — the four boxes, the progress
-- rail and the saved days are untouched. Run it when convenient; until then
-- the pad simply says it cannot be loaded.

begin;

-- One running page per account, beside the four boxes rather than inside
-- them. Deliberately not a fifth `my_space_box`: the boxes are lists of
-- items with something to complete, snapshotted into my_space_days and
-- cleared when the day is saved, and this is free text that carries on
-- across days. A pad in my_space_items would have been an item with no
-- length limit, no completion state and no place on the progress rail.
--
-- The unique constraint on user_id is what makes every write an upsert onto
-- one row, so a person's pad cannot fork into two.
create table if not exists public.my_space_notes (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null,
  text text default '' not null,
  updated_at timestamp with time zone default now() not null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'my_space_notes_user_id_unique'
  ) then
    alter table public.my_space_notes
      add constraint my_space_notes_user_id_unique unique (user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'my_space_notes_user_id_users_id_fk'
  ) then
    alter table public.my_space_notes
      add constraint my_space_notes_user_id_users_id_fk
      foreign key (user_id) references public.users(id)
      on delete no action on update no action;
  end if;
end $$;

-- Row level security, then the app role's policy. My Space is private to its
-- owner; this table holds free-form personal notes and is never read by a
-- leader's manager, so it gets the same treatment as the rest of the board.
alter table public.my_space_notes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'my_space_notes' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.my_space_notes for all to emr_app using (true) with check (true);
  end if;
end $$;

-- The deployed app reads and writes through the limited role; its default
-- privileges cover tables postgres creates later, and this makes the grant
-- explicit where the role exists. No-op where it does not.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'emr_app') then
    grant select, insert, update, delete on public.my_space_notes to emr_app;
  end if;
end $$;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select 'cfa995d767bca17483a7e5e53279d8f3805b88864e6699d24e0b1bbcc54d5859', 1789999429951 -- 0059_my_space_notepad
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = 'cfa995d767bca17483a7e5e53279d8f3805b88864e6699d24e0b1bbcc54d5859');

commit;

-- Verify: expect 1, 1, 1, 1, 1 and 0 pads so far.
select
  (select count(*) from information_schema.tables where table_name = 'my_space_notes') as table_present,
  (select count(*) from pg_policies where tablename = 'my_space_notes' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from pg_constraint where conname = 'my_space_notes_user_id_unique') as one_per_account,
  (select count(*) from pg_constraint where conname = 'my_space_notes_user_id_users_id_fk') as owner_linked,
  (select count(*) from drizzle.__drizzle_migrations where hash = 'cfa995d767bca17483a7e5e53279d8f3805b88864e6699d24e0b1bbcc54d5859') as tracked,
  (select count(*) from public.my_space_notes) as pads;
