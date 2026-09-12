-- The database role the deployed app connects as.
--
-- The app only reads and writes rows in the public schema (it never changes
-- structure: migrations are run by hand as postgres), so this role gets
-- exactly that and nothing else: no auth schema beyond the one table the
-- Users page reads, no DDL, no ownership. A leaked connection string for it
-- can damage application rows, which backups cover, but cannot drop tables,
-- read Supabase's own account data, or reach other schemas.
--
-- Row-level security is on for every public table (that is what shuts the
-- browser's public key out), and a role that is not the table owner is
-- subject to it, so the app role gets an allow-everything policy on each
-- table. Safe to run again at any time — after every migration that adds a
-- table, in fact, or the app cannot see the new table.
--
-- Before running: replace CHANGE_ME with a strong password (openssl rand
-- -hex 24 gives a good one with no characters that need escaping in a URL).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'emr_app') then
    create role emr_app login password 059bebef50a5bc80d7b44ed4e23871951890073f0d361aa8;
  end if;
end $$;

-- Rows in public: read, write, and the sequences behind generated codes.
grant usage on schema public to emr_app;
grant select, insert, update, delete on all tables in schema public to emr_app;
grant usage, select, update on all sequences in schema public to emr_app;
-- ...and the same on tables and sequences future migrations create as postgres.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to emr_app;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to emr_app;

-- The one read outside public: who has paired an authenticator, for the
-- Users page. If this part is refused, the page shows "Unavailable" in that
-- column and everything else still works.
do $$
begin
  grant usage on schema auth to emr_app;
  grant select on auth.mfa_factors to emr_app;
exception when others then
  raise notice 'auth.mfa_factors not granted: %', sqlerrm;
end $$;

-- Through row-level security on every public table.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t.tablename and policyname = 'emr_app_full_access'
    ) then
      execute format(
        'create policy emr_app_full_access on public.%I for all to emr_app using (true) with check (true)',
        t.tablename
      );
    end if;
  end loop;
end $$;

-- What the role ended up with, for the eye.
select count(*) as tables_readable
from information_schema.role_table_grants
where grantee = 'emr_app' and table_schema = 'public' and privilege_type = 'SELECT';
