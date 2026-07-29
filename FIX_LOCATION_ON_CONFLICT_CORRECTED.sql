-- ============================================================
-- FIX LOCATION UNIQUE CONSTRAINT
-- Corrected version: does not use a temporary table.
-- Run this entire script in Supabase SQL Editor.
-- ============================================================

begin;

create extension if not exists citext;

create table if not exists public.locations (
  id bigint generated always as identity primary key,
  location_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_locations (
  staff_id bigint not null references public.staff_records(id) on delete cascade,
  location_id bigint not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, location_id)
);

-- Normalize leading/trailing spaces.
update public.locations
set location_name = btrim(location_name)
where location_name is not null
  and location_name <> btrim(location_name);

-- Copy employee assignments from duplicate location rows
-- to the lowest-ID surviving location row.
with location_merge_map as (
  select
    id as duplicate_id,
    min(id) over (
      partition by lower(btrim(location_name))
    ) as keep_id
  from public.locations
)
insert into public.staff_locations (staff_id, location_id)
select distinct
  sl.staff_id,
  m.keep_id
from public.staff_locations sl
join location_merge_map m
  on m.duplicate_id = sl.location_id
where m.duplicate_id <> m.keep_id
on conflict (staff_id, location_id) do nothing;

-- Remove employee assignments that point to duplicate rows.
with location_merge_map as (
  select
    id as duplicate_id,
    min(id) over (
      partition by lower(btrim(location_name))
    ) as keep_id
  from public.locations
)
delete from public.staff_locations sl
using location_merge_map m
where sl.location_id = m.duplicate_id
  and m.duplicate_id <> m.keep_id;

-- Delete the duplicate location rows.
with location_merge_map as (
  select
    id as duplicate_id,
    min(id) over (
      partition by lower(btrim(location_name))
    ) as keep_id
  from public.locations
)
delete from public.locations l
using location_merge_map m
where l.id = m.duplicate_id
  and m.duplicate_id <> m.keep_id;

-- Remove the previous expression index because PostgREST upsert cannot
-- use it for ON CONFLICT(location_name).
drop index if exists public.locations_name_uq;

alter table public.locations
  drop constraint if exists locations_location_name_key;

-- Convert the location name to case-insensitive text.
alter table public.locations
  alter column location_name type citext
  using btrim(location_name)::citext;

-- Add the true unique constraint required by the application upsert.
alter table public.locations
  add constraint locations_location_name_key unique (location_name);

grant select, insert, update on public.locations to authenticated;
grant select, insert, delete on public.staff_locations to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verification
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.locations'::regclass
order by conname;
