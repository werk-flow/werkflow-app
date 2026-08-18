-- P1-06: vacation requests, decisions, and append-only audit.
-- Additive and default-preserving: an organization that configures nothing
-- sees only the honest empty state; no rows are invented.

create extension if not exists btree_gist with schema extensions;

create table public.vacation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  start_date date not null,
  end_date date not null,
  day_portion text not null default 'full'
    check (day_portion in ('full', 'half_day')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  comment text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  -- Snapshot of entitlement days consumed per vacation year, written at
  -- approval time so later configuration changes never silently rewrite a
  -- decided balance. Example: {"2026": 4.5}
  approved_days_by_year jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacation_requests_range_valid check (end_date >= start_date),
  -- Half days are single-day requests only (V1 granularity decision).
  constraint vacation_requests_half_day_single_day
    check (day_portion <> 'half_day' or start_date = end_date),
  -- Overlapping own requests in non-terminal states are impossible, race-safe.
  constraint vacation_requests_no_active_overlap exclude using gist (
    employee_record_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'))
);

create index vacation_requests_org_status_idx
  on public.vacation_requests (organization_id, status);
create index vacation_requests_record_idx
  on public.vacation_requests (employee_record_id, start_date);
create index vacation_requests_requested_by_idx
  on public.vacation_requests (requested_by);
create index vacation_requests_decided_by_idx
  on public.vacation_requests (decided_by);
create index vacation_requests_cancelled_by_idx
  on public.vacation_requests (cancelled_by);

create table public.vacation_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacation_request_id uuid not null references public.vacation_requests(id) on delete cascade,
  event_type text not null
    check (event_type in ('requested', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index vacation_request_events_request_idx
  on public.vacation_request_events (vacation_request_id, created_at);
create index vacation_request_events_org_idx
  on public.vacation_request_events (organization_id);
create index vacation_request_events_created_by_idx
  on public.vacation_request_events (created_by);

-- Organization-consistency triggers (established app_private pattern).
create or replace function app_private.validate_vacation_request_org()
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
    raise exception 'vacation_request employee record organization mismatch';
  end if;
  return new;
end;
$$;

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
  ) then
    raise exception 'vacation_request_event request organization mismatch';
  end if;
  return new;
end;
$$;

create trigger vacation_requests_validate
  before insert or update on public.vacation_requests
  for each row execute function app_private.validate_vacation_request_org();

create trigger vacation_requests_updated_at
  before update on public.vacation_requests
  for each row execute function update_updated_at_column();

create trigger vacation_request_events_validate
  before insert or update on public.vacation_request_events
  for each row execute function app_private.validate_vacation_request_event_org();

-- RLS: self-or-manager SELECT through SECURITY DEFINER helpers (never a
-- subquery on an RLS-protected table); all writes go through service-role
-- server actions. Employee approvers read via server actions, not RLS.
alter table public.vacation_requests enable row level security;
alter table public.vacation_request_events enable row level security;

create policy "Managers and the person can view vacation requests"
  on public.vacation_requests for select
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

create policy "Managers and the person can view vacation request events"
  on public.vacation_request_events for select
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or vacation_request_id in (
      select vr.id from public.vacation_requests vr
      where vr.employee_record_id in (
        select app_private.get_user_employee_record_ids((select auth.uid()))
      )
    )
  );

-- Realtime: publication + full replica identity so org-filtered DELETE events
-- keep their filter column. The audit table stays unpublished like other
-- per-domain audit logs.
alter table public.vacation_requests replica identity full;
alter publication supabase_realtime add table public.vacation_requests;