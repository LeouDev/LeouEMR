-- Custom SQL migration file, put your code below! --

-- Missed when skill_aliases was added; keeps it consistent with the
-- fail-closed baseline from 0001.
alter table public.skill_aliases enable row level security;
