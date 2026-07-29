-- ============================================================
-- ACCOUNT CREATOR: MAKE NOTE OPTIONAL
-- Run this once in Supabase SQL Editor.
-- Notes will still save and display, but will no longer affect
-- Complete/Incomplete status or the completion percentage.
-- ============================================================

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
    s.account_created is not null
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
      (s.account_created is not null)::int
    ) / 22.0,
    1
  ) as completion_percent
from public.staff_records s;

grant select on public.staff_records_with_status to authenticated;

notify pgrst, 'reload schema';

select
  count(*) filter (where is_complete) as complete_records,
  count(*) filter (where not is_complete) as incomplete_records
from public.staff_records_with_status;
