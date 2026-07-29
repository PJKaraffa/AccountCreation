-- ============================================================
-- DATABASE EDIT FIX
-- Run this once in Supabase SQL Editor.
-- ============================================================

begin;

drop index if exists public.staff_records_cert_number_uq;

alter table public.staff_records
  drop constraint if exists staff_records_cert_number_key;

alter table public.staff_records
  drop constraint if exists staff_records_cert_number_uq;

alter table public.staff_records
  drop constraint if exists staff_records_cert_number_check;

update public.staff_records
set cert_number =
  case
    when cert_number is null or btrim(cert_number) = '' then null
    when upper(regexp_replace(btrim(cert_number), '[^A-Z]', '', 'g')) = 'NONCERT'
      then 'NON-CERT'
    else 'CERT'
  end;

alter table public.staff_records
  add constraint staff_records_cert_number_check
  check (cert_number is null or cert_number in ('CERT', 'NON-CERT'));

create unique index if not exists staff_records_employee_id_uq
  on public.staff_records (lower(btrim(employee_id)))
  where employee_id is not null and btrim(employee_id) <> '';

commit;

select
  id,
  first_name,
  last_name,
  employee_id,
  cert_number
from public.staff_records
order by last_name, first_name;
