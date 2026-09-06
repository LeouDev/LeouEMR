-- Custom SQL migration file, put your code below! --

-- The sign-up form now collects 201-file details. They arrive as auth user
-- metadata, and this extends the existing trigger to write both the account
-- row and the profile in the same transaction — so an account can never
-- exist without its personnel record, and no second round trip is needed
-- while the new user has no session yet.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text;
begin
  full_name := nullif(trim(
    coalesce(meta->>'firstName', '') || ' ' || coalesce(meta->>'lastName', '')
  ), '');

  insert into public.users (id, email, name, role, status, employee_eid)
  values (
    new.id,
    new.email,
    coalesce(full_name, meta->>'name', split_part(new.email, '@', 1)),
    'agent',
    'pending',
    nullif(meta->>'employeeEid', '')
  )
  on conflict (id) do nothing;

  -- Only written when the sign-up supplied the required details; an account
  -- created by other means simply has no profile yet.
  if coalesce(meta->>'lastName', '') <> ''
     and coalesce(meta->>'firstName', '') <> ''
     and coalesce(meta->>'position', '') <> ''
     and coalesce(meta->>'employeeEid', '') <> '' then
    insert into public.employee_profiles (
      user_id, employee_eid, last_name, first_name, middle_name, position,
      address_line_1, address_line_2, city_province, country, zipcode,
      phone_number, emergency_contact_name, emergency_contact_number,
      emergency_contact_relationship
    ) values (
      new.id,
      meta->>'employeeEid',
      meta->>'lastName',
      meta->>'firstName',
      nullif(meta->>'middleName', ''),
      (meta->>'position')::"position",
      nullif(meta->>'addressLine1', ''),
      nullif(meta->>'addressLine2', ''),
      nullif(meta->>'cityProvince', ''),
      nullif(meta->>'country', ''),
      nullif(meta->>'zipcode', ''),
      nullif(meta->>'phoneNumber', ''),
      nullif(meta->>'emergencyContactName', ''),
      nullif(meta->>'emergencyContactNumber', ''),
      nullif(meta->>'emergencyContactRelationship', '')
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

alter table public.employee_profiles enable row level security;
