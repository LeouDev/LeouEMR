-- One paste, one transaction: apply migration 0061 (the EWS tracker), give
-- the app role its policy on the new table, and record the migration in
-- drizzle's tracker. Safe to run twice. Plain idempotent SQL throughout,
-- no PL/pgSQL, for the reason APPLY_0060 gives.
--
-- What it adds:
--   * ews_assessments.expected_return — for a leave state, the day the
--     person is expected back (the register flags an overdue return).
--   * ews_assessments.action_plan — what the team leader has decided to do
--     (MONITORING, SKIP_LEVEL, ADMIN_HEARING, OTHER), null when nothing.
--   * ews_headcount — a team leader's monthly headcount movement, one row
--     per team per month; the opening carries forward unless overridden
--     and the closing is arithmetic in the app.
--
-- Nothing breaks without this, but the new EWS pages need it: the My Team
-- edit form writes the two columns and the Headcount tab reads the table,
-- so run it before the release that carries them is deployed.

begin;

alter table public.ews_assessments add column if not exists expected_return date;
alter table public.ews_assessments add column if not exists action_plan text;

create table if not exists public.ews_headcount (
  id uuid primary key default gen_random_uuid() not null,
  supervisor_eid text not null,
  year integer not null,
  month integer not null,
  opening_override integer,
  new_hires integer default 0 not null,
  transfer_in integer default 0 not null,
  transfer_out integer default 0 not null,
  voluntary_attrition integer default 0 not null,
  involuntary_attrition integer default 0 not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null
);

-- Dropped and re-added rather than guarded, which is idempotent without
-- PL/pgSQL; the table is empty or consistent either way.
alter table public.ews_headcount
  drop constraint if exists ews_headcount_updated_by_users_id_fk;
alter table public.ews_headcount
  add constraint ews_headcount_updated_by_users_id_fk
  foreign key (updated_by) references public.users(id)
  on delete no action on update no action;

create unique index if not exists ews_headcount_team_month_idx
  on public.ews_headcount using btree (supervisor_eid, year, month);

-- Row level security and the app role's policy, the same treatment every
-- table since 0001 has. Dropped first so the create is idempotent.
alter table public.ews_headcount enable row level security;

drop policy if exists emr_app_full_access on public.ews_headcount;
create policy emr_app_full_access on public.ews_headcount
  for all to emr_app using (true) with check (true);

grant select, insert, update, delete on public.ews_headcount to emr_app;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '1c5bd0956d5ea4b50347fb2b8256893c28039b507ed6626aa4dcf004308971ae', 1790069253232
 where not exists (
   select 1 from drizzle.__drizzle_migrations
   where hash = '1c5bd0956d5ea4b50347fb2b8256893c28039b507ed6626aa4dcf004308971ae'
 );

commit;

-- Verify: expect 2, 1, 1, 1, 1.
select
  (select count(*) from information_schema.columns
     where table_name = 'ews_assessments' and column_name in ('expected_return', 'action_plan')) as columns_present,
  (select count(*) from information_schema.tables where table_name = 'ews_headcount') as table_present,
  (select count(*) from pg_indexes where tablename = 'ews_headcount' and indexname = 'ews_headcount_team_month_idx') as index_present,
  (select count(*) from pg_policies where tablename = 'ews_headcount' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from drizzle.__drizzle_migrations
     where hash = '1c5bd0956d5ea4b50347fb2b8256893c28039b507ed6626aa4dcf004308971ae') as tracked;
