-- One paste, one transaction: apply migration 0062 (the utilization
-- report's activity table), give the app role its policy on it, and record
-- the migration in drizzle's tracker. Safe to run twice. Plain idempotent
-- SQL throughout, no PL/pgSQL, for the reason APPLY_0060 gives.
--
-- user_activity_days holds one row per account per Manila day it opened
-- the app — a headcount of use for the utilization report under Survey
-- Results (who uses the tool day to day, by team and by manager), nothing
-- about what anyone looked at. The browser pings once a day; until this
-- runs the ping fails soft and the report shows only what the audit log
-- already knows (EOD reports sent, records written).

begin;

create table if not exists public.user_activity_days (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null,
  day date not null,
  first_seen timestamp with time zone default now() not null,
  last_seen timestamp with time zone default now() not null
);

alter table public.user_activity_days
  drop constraint if exists user_activity_days_user_id_users_id_fk;
alter table public.user_activity_days
  add constraint user_activity_days_user_id_users_id_fk
  foreign key (user_id) references public.users(id)
  on delete cascade on update no action;

create unique index if not exists user_activity_days_user_day_idx
  on public.user_activity_days using btree (user_id, day);
create index if not exists user_activity_days_day_idx
  on public.user_activity_days using btree (day);

alter table public.user_activity_days enable row level security;

drop policy if exists emr_app_full_access on public.user_activity_days;
create policy emr_app_full_access on public.user_activity_days
  for all to emr_app using (true) with check (true);

grant select, insert, update, delete on public.user_activity_days to emr_app;

insert into drizzle.__drizzle_migrations (hash, created_at)
select 'ede1f12980006432f3da6e94026155cedab96471b846b191e4e9bd2f971169b1', 1790137069511
 where not exists (
   select 1 from drizzle.__drizzle_migrations
   where hash = 'ede1f12980006432f3da6e94026155cedab96471b846b191e4e9bd2f971169b1'
 );

commit;

-- Verify: expect 1, 2, 1, 1.
select
  (select count(*) from information_schema.tables where table_name = 'user_activity_days') as table_present,
  (select count(*) from pg_indexes where tablename = 'user_activity_days'
     and indexname in ('user_activity_days_user_day_idx', 'user_activity_days_day_idx')) as indexes_present,
  (select count(*) from pg_policies where tablename = 'user_activity_days' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = 'ede1f12980006432f3da6e94026155cedab96471b846b191e4e9bd2f971169b1') as tracked;
