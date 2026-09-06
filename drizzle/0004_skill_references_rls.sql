-- Custom SQL migration file, put your code below! --

-- Keeps skill_references consistent with the fail-closed RLS baseline
-- established in 0001: the publishable/anon key can read nothing directly.
-- The app reads this table server-side through Drizzle.
alter table public.skill_references enable row level security;
