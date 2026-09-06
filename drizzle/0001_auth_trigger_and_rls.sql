-- Custom SQL migration file, put your code below! --

-- ---------------------------------------------------------------------------
-- auth.users -> public.users sync
--
-- Every new Supabase Auth signup lands here as role='agent', status='pending'
-- — the least-privileged possible default. An admin must promote the role
-- and flip status to 'active' via the Users admin page before the account
-- can do anything (mirrors the existing EWS app's signup/approval pattern).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'agent',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security: deny-by-default baseline.
--
-- Primary authorization for this platform lives in the Next.js API layer
-- (every route derives the caller's role/scope from their session and
-- authorizes server-side — spec section 28). RLS here is defense-in-depth:
-- enabling it with no policies means the publishable/anon key can read or
-- write NOTHING until a specific policy says otherwise, so a bug or a
-- leaked anon key can't expose data before real per-route authorization
-- exists. Only the service_role key (used server-side only, never shipped
-- to the client) bypasses RLS entirely.
--
-- The one deliberate exception: a user may read their own `users` row
-- directly, matching the existing EWS app's pattern of client-side session
-- bootstrapping (knowing your own id/role/email isn't a leak). No update
-- policy is granted — role/status changes must go through the admin API.
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.employees enable row level security;
alter table public.kpi_definitions enable row level security;
alter table public.import_batches enable row level security;
alter table public.weekly_metric_results enable row level security;
alter table public.performance_issues enable row level security;
alter table public.weekly_issue_history enable row level security;
alter table public.action_items enable row level security;
alter table public.root_cause_categories enable row level security;
alter table public.rca_entries enable row level security;
alter table public.action_plans enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

create policy "users can read their own row"
  on public.users for select
  to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Seed data: root cause categories (spec section 7 — configurable later
-- via the KPI/config admin UI, but the initial fixed list is spelled out
-- in the spec itself, so it's safe to seed directly).
-- ---------------------------------------------------------------------------

insert into public.root_cause_categories (code, label) values
  ('knowledge_gap', 'Knowledge Gap'),
  ('skill_gap', 'Skill Gap'),
  ('process_adherence', 'Process Adherence'),
  ('productivity', 'Productivity'),
  ('attendance', 'Attendance'),
  ('behavioral', 'Behavioral'),
  ('system_technical_issue', 'System/Technical Issue'),
  ('training_gap', 'Training Gap'),
  ('workload', 'Workload'),
  ('external_factor', 'External Factor'),
  ('other', 'Other')
on conflict (code) do nothing;
