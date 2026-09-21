-- One paste, one transaction: apply migration 0060 (the action plan's
-- category list), seed the seventeen options, give the app role its policy
-- on the new table, and record the migration in drizzle's tracker. Safe to
-- run twice.
--
-- Deliberately written without a single PL/pgSQL DO block, unlike the
-- apply scripts before it. The first attempt at this one failed in the
-- Supabase editor with "unterminated dollar-quoted string": the text that
-- reached Postgres stopped inside the last block, before it was closed.
-- Whether that was the paste or the editor, every guard here is now plain
-- idempotent SQL — `if not exists`, or `drop ... if exists` before the
-- create — so there is no dollar quoting left to be cut in half.
--
-- Nothing breaks without this. The dropdown reads its options from this
-- table and the read fails soft, so until it runs the category select is
-- empty and the rest of the action item page is untouched.

begin;

-- What a team leader is going to do about an item: the action plan's
-- counterpart to root_cause_categories, and configurable the same way. A
-- category can be renamed, reordered, regrouped or retired here without a
-- deploy; `active = false` retires one without breaking plans that point at
-- it.
create table if not exists public.action_plan_categories (
  id uuid primary key default gen_random_uuid() not null,
  code text not null,
  label text not null,
  group_label text default '' not null,
  sort_order integer default 0 not null,
  active boolean default true not null
);

-- Dropped and re-added rather than guarded, which is idempotent without
-- PL/pgSQL. Safe on a re-run: the seed below only ever inserts distinct
-- codes, so there is never a duplicate to block the constraint coming back.
alter table public.action_plan_categories
  drop constraint if exists action_plan_categories_code_unique;
alter table public.action_plan_categories
  add constraint action_plan_categories_code_unique unique (code);

-- Nullable on purpose. Every plan written before this list existed has prose
-- and no category; classifying those after the fact would mean inventing a
-- choice nobody made. The form requires one for anything new.
alter table public.action_plans add column if not exists category_id uuid;

alter table public.action_plans
  drop constraint if exists action_plans_category_id_action_plan_categories_id_fk;
alter table public.action_plans
  add constraint action_plans_category_id_action_plan_categories_id_fk
  foreign key (category_id) references public.action_plan_categories(id)
  on delete no action on update no action;

-- The seventeen, in the three groups the form reads them in: what is done
-- with the agent, what is raised elsewhere, and what is still being worked
-- out. Sorted by group, then alphabetically inside it; "Other" sits last on
-- its own so it is never what a tired reader lands on by accident.
insert into public.action_plan_categories (code, label, group_label, sort_order) values
  ('comms_training',        'Comms Training',                       'With the agent',         10),
  ('disciplinary_action',   'Disciplinary Action',                  'With the agent',         10),
  ('peer_feedback',         'Peer Feedback',                        'With the agent',         10),
  ('process_refresher',     'Process Refresher',                    'With the agent',         10),
  ('recovery_call',         'Recovery Call',                        'With the agent',         10),
  ('remote_monitoring',     'Remote Monitoring',                    'With the agent',         10),
  ('revisit_job_aid',       'Revisit Job Aid',                      'With the agent',         10),
  ('enhance_cmm',           'Enhance CMM Features',                 'Raised elsewhere',       20),
  ('enhance_pas',           'Enhance PAS',                          'Raised elsewhere',       20),
  ('raise_hd_ticket',       'Raise HD Ticket',                      'Raised elsewhere',       20),
  ('request_new_asset',     'Request New Asset',                    'Raised elsewhere',       20),
  ('request_recording',     'Request Recording',                    'Raised elsewhere',       20),
  ('update_secure_access',  'Update Secure Access',                 'Raised elsewhere',       20),
  ('investigate_technical', 'Investigate Technical Issue',          'Still being worked out', 30),
  ('monitor_for_rto',       'Monitor for RTO',                      'Still being worked out', 30),
  ('validate_behavior_sys', 'Validate if Behavior or System Issue', 'Still being worked out', 30),
  ('other',                 'Other',                                '',                       40)
on conflict (code) do nothing;

-- Row level security and the app role's policy — the same treatment
-- root_cause_categories has, being the same kind of reference list. Dropped
-- first so the create is idempotent; Postgres has no CREATE POLICY IF NOT
-- EXISTS.
alter table public.action_plan_categories enable row level security;

drop policy if exists emr_app_full_access on public.action_plan_categories;
create policy emr_app_full_access on public.action_plan_categories
  for all to emr_app using (true) with check (true);

-- The deployed app reads through the limited role. Unguarded, unlike the
-- earlier scripts: if emr_app does not exist this rolls the whole thing back
-- and says so, which is better than quietly leaving the app unable to read
-- its own list.
grant select, insert, update, delete on public.action_plan_categories to emr_app;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '3d7cbf6a8d574fa4deeb23e698a17c07fe005279be32b7e1f9866491b76fe0f3', 1790016906084
 where not exists (
   select 1 from drizzle.__drizzle_migrations
   where hash = '3d7cbf6a8d574fa4deeb23e698a17c07fe005279be32b7e1f9866491b76fe0f3'
 );

commit;

-- Verify: expect 1, 1, 1, 17, 3, 1.
select
  (select count(*) from information_schema.tables where table_name = 'action_plan_categories') as table_present,
  (select count(*) from pg_policies where tablename = 'action_plan_categories' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from information_schema.columns
     where table_name = 'action_plans' and column_name = 'category_id') as column_present,
  (select count(*) from public.action_plan_categories where active) as categories,
  (select count(distinct group_label) from public.action_plan_categories where group_label <> '') as groups,
  (select count(*) from drizzle.__drizzle_migrations
     where hash = '3d7cbf6a8d574fa4deeb23e698a17c07fe005279be32b7e1f9866491b76fe0f3') as tracked;
