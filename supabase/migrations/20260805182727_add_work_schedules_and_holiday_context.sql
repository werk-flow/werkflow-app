-- P1-04: date-effective work schedules + regional holiday / closure context.
-- Additive only: no rows are created for existing members (owner decision:
-- missing schedules resolve to a labeled display-time fallback, never stored).

-- 1) Work schedules: weekly pattern versions per employee record.
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  valid_from date not null,
  monday_minutes integer not null default 0,
  tuesday_minutes integer not null default 0,
  wednesday_minutes integer not null default 0,
  thursday_minutes integer not null default 0,
  friday_minutes integer not null default 0,
  saturday_minutes integer not null default 0,
  sunday_minutes integer not null default 0,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_schedules_unique_valid_from unique (employee_record_id, valid_from),
  constraint work_schedules_monday_minutes_range check (monday_minutes between 0 and 1440),
  constraint work_schedules_tuesday_minutes_range check (tuesday_minutes between 0 and 1440),
  constraint work_schedules_wednesday_minutes_range check (wednesday_minutes between 0 and 1440),
  constraint work_schedules_thursday_minutes_range check (thursday_minutes between 0 and 1440),
  constraint work_schedules_friday_minutes_range check (friday_minutes between 0 and 1440),
  constraint work_schedules_saturday_minutes_range check (saturday_minutes between 0 and 1440),
  constraint work_schedules_sunday_minutes_range check (sunday_minutes between 0 and 1440)
);

create index work_schedules_org_idx on public.work_schedules (organization_id);
create index work_schedules_record_valid_from_idx
  on public.work_schedules (employee_record_id, valid_from desc);

alter table public.work_schedules enable row level security;

-- First employee-self read path on personnel-adjacent data (owner decision):
-- managers see all org schedules, a person sees exactly their own rows.
-- Writes stay service-role only (no insert/update/delete policies).
create policy "Managers and the person can view work schedules"
  on public.work_schedules
  for select
  to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or exists (
      select 1
      from public.employee_records er
      where er.id = work_schedules.employee_record_id
        and er.user_id = (select auth.uid())
    )
  );

create or replace function app_private.validate_work_schedule_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id
      and er.organization_id = new.organization_id
  ) then
    raise exception 'work_schedule employee record organization mismatch';
  end if;
  return new;
end;
$$;

create trigger work_schedules_validate
  before insert or update on public.work_schedules
  for each row execute function app_private.validate_work_schedule_org();

create trigger work_schedules_updated_at
  before update on public.work_schedules
  for each row execute function public.update_updated_at_column();

-- DELETE realtime events must still carry organization_id for the org-filtered
-- channel; the default replica identity (pk only) would drop them.
alter table public.work_schedules replica identity full;

-- 2) Organization closure days (Betriebsruhe). Rows are inherently dated;
-- app-side rule (V1): only today/future dates may be added or removed so past
-- targets are never silently rewritten.
create table public.organization_closure_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  closure_date date not null,
  label text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint organization_closure_days_unique unique (organization_id, closure_date)
);

create index organization_closure_days_org_date_idx
  on public.organization_closure_days (organization_id, closure_date);

alter table public.organization_closure_days enable row level security;

-- Org-public planning context: every member may read; writes are service-role only.
create policy "Members can view closure days"
  on public.organization_closure_days
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_closure_days.organization_id
        and m.user_id = (select auth.uid())
    )
  );

alter table public.organization_closure_days replica identity full;

-- 3) Holiday region selection on organization_settings, with effective-from
-- history following the break_policy_history precedent (a historical date
-- resolves against the region effective on that date; no retroactive effect
-- before the first selection).
alter table public.organization_settings
  add column holiday_region text,
  add column holiday_region_history jsonb not null default '[]'::jsonb;

alter table public.organization_settings
  add constraint organization_settings_holiday_region_check
  check (
    holiday_region is null or holiday_region in (
      'BW','BY','BY_OHNE_MARIAE','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'
    )
  );

-- 4) Realtime publication.
alter publication supabase_realtime add table public.work_schedules;
alter publication supabase_realtime add table public.organization_closure_days;