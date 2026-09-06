-- Custom SQL migration file, put your code below! --

-- One account per person.
--
-- Supabase already enforces one account per email address in auth.users;
-- these close the same door on the identifiers this system keys on, so the
-- same employee cannot end up with two accounts under different emails and
-- appear twice in a 201 file or split their performance history.
create unique index if not exists employee_profiles_employee_eid_key
  on public.employee_profiles (employee_eid);

-- MSID is optional, so uniqueness applies only where one is supplied.
create unique index if not exists employee_profiles_msid_key
  on public.employee_profiles (lower(msid))
  where msid is not null;

-- Mirrors the same rule on the account itself: users.employee_eid is
-- already unique, and email uniqueness is enforced by auth.users.
