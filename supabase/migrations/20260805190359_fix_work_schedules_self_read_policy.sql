-- The original self-read branch queried employee_records directly; that
-- subquery runs under the caller's RLS (manager-only on employee_records), so
-- an employee could never match their own schedule rows. Mirror the existing
-- app_private security-definer helper pattern instead.

create or replace function app_private.get_user_employee_record_ids(p_user_id uuid)
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select id
  from public.employee_records
  where user_id = p_user_id;
$$;

drop policy "Managers and the person can view work schedules" on public.work_schedules;

create policy "Managers and the person can view work schedules"
  on public.work_schedules
  for select
  to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );