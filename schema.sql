-- ============================================================
-- ACCOUNT CREATOR
-- Run this entire script in the Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- -----------------------------
-- Profiles / roles
-- -----------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------
-- Main personnel table
-- -----------------------------
create table if not exists public.staff_records (
  id bigint generated always as identity primary key,

  -- This legacy column name is retained for compatibility.
  -- It now stores only CERT or NON-CERT.
  cert_number text check (
    cert_number is null or cert_number in ('CERT', 'NON-CERT')
  ),
  last_name text,
  first_name text,
  position text,
  location text,
  doh date,
  ein text,
  dob date,
  gender text,
  race_ethnicity text check (
    race_ethnicity is null or race_ethnicity in (
      'Hispanic/Latino (of any race)',
      'American Indian or Alaska Native',
      'Asian',
      'Black or African American',
      'Native Hawaiian or Other Pacific Islander',
      'White',
      'Two or More Races'
    )
  ),
  employee_id text,
  degree text check (
    degree is null or degree in (
      'Associate',
      'Bachelor''s',
      'Master''s',
      '6th Year',
      'Doctorate'
    )
  ),
  years_experience numeric(5,2),
  district_email text,
  email text,
  cell_phone text,
  nda_signed boolean,
  power_school boolean,
  previous_boe boolean,
  data_management_1 boolean,
  data_management_2 boolean,
  account_created boolean,
  note text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CERT/NON-CERT is a classification shared by many employees, so it must not be unique.
drop index if exists public.staff_records_cert_number_uq;

-- Safe upgrade for an existing installation.
-- Any old nonblank certification-number text is converted to CERT.
update public.staff_records
set cert_number = case
  when upper(btrim(cert_number)) in ('NON-CERT', 'NON CERT', 'NONCERT') then 'NON-CERT'
  when cert_number is null or btrim(cert_number) = '' then null
  else 'CERT'
end
where cert_number is not null;

alter table public.staff_records
drop constraint if exists staff_records_cert_number_check;

alter table public.staff_records
add constraint staff_records_cert_number_check
check (cert_number is null or cert_number in ('CERT', 'NON-CERT'));

create unique index if not exists staff_records_employee_id_uq
  on public.staff_records (lower(employee_id))
  where employee_id is not null and btrim(employee_id) <> '';


-- -----------------------------
-- Multiple locations
-- The legacy staff_records.location column stores a readable joined value
-- so completeness checks, exports, and audit history remain straightforward.
-- -----------------------------
create table if not exists public.locations (
  id bigint generated always as identity primary key,
  location_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists locations_name_uq
  on public.locations (lower(location_name));

create table if not exists public.staff_locations (
  staff_id bigint not null references public.staff_records(id) on delete cascade,
  location_id bigint not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, location_id)
);

-- Convert any existing single-location values into the new relationship tables.
insert into public.locations (location_name)
select distinct btrim(location)
from public.staff_records
where nullif(btrim(location),'') is not null
on conflict do nothing;

insert into public.staff_locations (staff_id, location_id)
select s.id, l.id
from public.staff_records s
join public.locations l on lower(l.location_name) = lower(btrim(s.location))
where nullif(btrim(s.location),'') is not null
on conflict do nothing;

-- -----------------------------
-- Audit history
-- -----------------------------
create table if not exists public.staff_record_audit (
  id bigint generated always as identity primary key,
  staff_record_id bigint,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

-- -----------------------------
-- Updated timestamp trigger
-- -----------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_staff_records_updated_at on public.staff_records;
create trigger trg_staff_records_updated_at
before update on public.staff_records
for each row execute function public.set_updated_at();

-- -----------------------------
-- Automatically create profiles
-- -----------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email,'@',1)),
    'user'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

-- Backfill existing users
insert into public.profiles (id, email, full_name, role)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'full_name', split_part(email,'@',1)),
  'user'
from auth.users
where email is not null
on conflict (id) do update
set email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name);

-- -----------------------------
-- Role helper
-- -----------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- -----------------------------
-- Audit trigger
-- -----------------------------
create or replace function public.audit_staff_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.staff_record_audit
      (staff_record_id, action, changed_by, old_data, new_data)
    values
      (new.id, 'INSERT', actor, null, to_jsonb(new));
    return new;

  elsif tg_op = 'UPDATE' then
    insert into public.staff_record_audit
      (staff_record_id, action, changed_by, old_data, new_data)
    values
      (new.id, 'UPDATE', actor, to_jsonb(old), to_jsonb(new));
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.staff_record_audit
      (staff_record_id, action, changed_by, old_data, new_data)
    values
      (old.id, 'DELETE', actor, to_jsonb(old), null);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_staff_record_audit on public.staff_records;
create trigger trg_staff_record_audit
after insert or update or delete on public.staff_records
for each row execute function public.audit_staff_record_change();

-- -----------------------------
-- Completeness view
-- Every listed business field is counted.
-- -----------------------------
create or replace view public.staff_records_with_status
with (security_invoker = true)
as
select
  s.*,
  (
    nullif(btrim(s.cert_number),'') is not null and
    nullif(btrim(s.last_name),'') is not null and
    nullif(btrim(s.first_name),'') is not null and
    nullif(btrim(s.position),'') is not null and
    nullif(btrim(s.location),'') is not null and
    s.doh is not null and
    nullif(btrim(s.ein),'') is not null and
    s.dob is not null and
    nullif(btrim(s.gender),'') is not null and
    nullif(btrim(s.race_ethnicity),'') is not null and
    nullif(btrim(s.employee_id),'') is not null and
    nullif(btrim(s.degree),'') is not null and
    s.years_experience is not null and
    nullif(btrim(s.district_email),'') is not null and
    nullif(btrim(s.email),'') is not null and
    nullif(btrim(s.cell_phone),'') is not null and
    s.nda_signed is not null and
    s.power_school is not null and
    s.previous_boe is not null and
    s.data_management_1 is not null and
    s.data_management_2 is not null and
    s.account_created is not null and
    nullif(btrim(s.note),'') is not null
  ) as is_complete,

  round(
    100.0 * (
      (nullif(btrim(s.cert_number),'') is not null)::int +
      (nullif(btrim(s.last_name),'') is not null)::int +
      (nullif(btrim(s.first_name),'') is not null)::int +
      (nullif(btrim(s.position),'') is not null)::int +
      (nullif(btrim(s.location),'') is not null)::int +
      (s.doh is not null)::int +
      (nullif(btrim(s.ein),'') is not null)::int +
      (s.dob is not null)::int +
      (nullif(btrim(s.gender),'') is not null)::int +
      (nullif(btrim(s.race_ethnicity),'') is not null)::int +
      (nullif(btrim(s.employee_id),'') is not null)::int +
      (nullif(btrim(s.degree),'') is not null)::int +
      (s.years_experience is not null)::int +
      (nullif(btrim(s.district_email),'') is not null)::int +
      (nullif(btrim(s.email),'') is not null)::int +
      (nullif(btrim(s.cell_phone),'') is not null)::int +
      (s.nda_signed is not null)::int +
      (s.power_school is not null)::int +
      (s.previous_boe is not null)::int +
      (s.data_management_1 is not null)::int +
      (s.data_management_2 is not null)::int +
      (s.account_created is not null)::int +
      (nullif(btrim(s.note),'') is not null)::int
    ) / 23.0,
    1
  ) as completion_percent
from public.staff_records s;

-- -----------------------------
-- Row Level Security
-- Users can view all records, create records, and edit records they created.
-- Administrators can do everything and see the audit log.
-- -----------------------------
alter table public.profiles enable row level security;
alter table public.staff_records enable row level security;
alter table public.staff_record_audit enable row level security;
alter table public.locations enable row level security;
alter table public.staff_locations enable row level security;

drop policy if exists "Profiles read own or admin" on public.profiles;
create policy "Profiles read own or admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "Profiles admin update" on public.profiles;
create policy "Profiles admin update"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated read staff" on public.staff_records;
create policy "Authenticated read staff"
on public.staff_records for select
to authenticated
using (true);

drop policy if exists "Authenticated insert staff" on public.staff_records;
create policy "Authenticated insert staff"
on public.staff_records for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "Owner or admin update staff" on public.staff_records;
create policy "Owner or admin update staff"
on public.staff_records for update
to authenticated
using (created_by = auth.uid() or public.is_admin())
with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "Admin delete staff" on public.staff_records;
create policy "Admin delete staff"
on public.staff_records for delete
to authenticated
using (public.is_admin());

drop policy if exists "Admin read audit" on public.staff_record_audit;
create policy "Admin read audit"
on public.staff_record_audit for select
to authenticated
using (public.is_admin());



drop policy if exists "Authenticated read locations" on public.locations;
create policy "Authenticated read locations"
on public.locations for select to authenticated using (true);

drop policy if exists "Authenticated add locations" on public.locations;
create policy "Authenticated add locations"
on public.locations for insert to authenticated with check (true);

drop policy if exists "Admin update locations" on public.locations;
create policy "Admin update locations"
on public.locations for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated read staff locations" on public.staff_locations;
create policy "Authenticated read staff locations"
on public.staff_locations for select to authenticated using (true);

drop policy if exists "Owner or admin insert staff locations" on public.staff_locations;
create policy "Owner or admin insert staff locations"
on public.staff_locations for insert to authenticated
with check (
  public.is_admin() or exists (
    select 1 from public.staff_records s
    where s.id = staff_id and s.created_by = auth.uid()
  )
);

drop policy if exists "Owner or admin delete staff locations" on public.staff_locations;
create policy "Owner or admin delete staff locations"
on public.staff_locations for delete to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.staff_records s
    where s.id = staff_id and s.created_by = auth.uid()
  )
);

-- Grant access needed by the browser client
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.staff_records to authenticated;
grant select on public.staff_records_with_status to authenticated;
grant select on public.staff_record_audit to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.locations to authenticated;
grant select, insert, delete on public.staff_locations to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================
-- MAKE YOURSELF AN ADMIN
-- Change the email address below, then run it after creating the user.
-- ============================================================
-- update public.profiles
-- set role = 'admin'
-- where lower(email) = lower('pkaraffa@bridgeportedu.net');
