-- The initial events policy embedded a subquery on the RLS-protected
-- vacation_requests table. Rule from the P1-04 RLS defect: policies must only
-- use app_private SECURITY DEFINER helpers. Denormalize employee_record_id
-- onto the event row (validated by trigger) so the self path is direct.

alter table public.vacation_request_events
  add column employee_record_id uuid references public.employee_records(id) on delete cascade;

create index vacation_request_events_record_idx
  on public.vacation_request_events (employee_record_id);

create or replace function app_private.validate_vacation_request_event_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.vacation_requests vr
    where vr.id = new.vacation_request_id
      and vr.organization_id = new.organization_id
      and vr.employee_record_id = new.employee_record_id
  ) then
    raise exception 'vacation_request_event request organization mismatch';
  end if;
  return new;
end;
$$;

drop policy "Managers and the person can view vacation request events"
  on public.vacation_request_events;

create policy "Managers and the person can view vacation request events"
  on public.vacation_request_events for select
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

alter table public.vacation_request_events
  alter column employee_record_id set not null;