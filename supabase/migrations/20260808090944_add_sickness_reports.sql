
-- P1-08: sickness / privacy-sensitive absence reports.
-- A report is a FACT (reported -> cancelled), never an approval lifecycle.
-- Patterns mirror vacation_requests (P1-06): org-scoped, keyed to the
-- employee record, gist exclusion against overlapping OWN ACTIVE sickness
-- (deliberately NOT against vacation — sickness during approved vacation is
-- a real case), append-only events, self-or-manager SELECT RLS via
-- app_private SECURITY DEFINER helpers, service-role writes only.

create table public.sickness_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  absence_type text not null default 'krankheit'
    check (absence_type in ('krankheit', 'kind_krank', 'sonstige')),
  start_date date not null,
  -- null = open-ended ("bis auf Weiteres"); set when the return date is known.
  end_date date,
  day_portion text not null default 'full'
    check (day_portion in ('full', 'half_day')),
  status text not null default 'reported'
    check (status in ('reported', 'cancelled')),
  evidence_required boolean not null default false,
  evidence_status text not null default 'not_required'
    check (evidence_status in ('not_required', 'pending', 'received')),
  reported_by uuid references auth.users(id) on delete set null,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sickness_reports_range_valid
    check (end_date is null or end_date >= start_date),
  -- A half day needs a known single day; an open-ended half day is meaningless.
  constraint sickness_reports_half_day_single_day
    check (day_portion <> 'half_day' or (end_date is not null and start_date = end_date)),
  -- Evidence state stays honest: the status vocabulary follows the flag.
  constraint sickness_reports_evidence_consistent
    check (
      (evidence_required and evidence_status in ('pending', 'received'))
      or (not evidence_required and evidence_status = 'not_required')
    ),
  -- Race-safe: one person cannot have two overlapping ACTIVE sickness reports.
  constraint sickness_reports_no_active_overlap
    exclude using gist (
      employee_record_id with =,
      daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
    ) where (status = 'reported')
);

create index sickness_reports_org_status_idx
  on public.sickness_reports (organization_id, status);
create index sickness_reports_employee_record_idx
  on public.sickness_reports (employee_record_id);
create index sickness_reports_reported_by_idx
  on public.sickness_reports (reported_by);
create index sickness_reports_cancelled_by_idx
  on public.sickness_reports (cancelled_by);

create table public.sickness_report_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sickness_report_id uuid not null references public.sickness_reports(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index sickness_report_events_report_idx
  on public.sickness_report_events (sickness_report_id);
create index sickness_report_events_org_idx
  on public.sickness_report_events (organization_id);
create index sickness_report_events_employee_record_idx
  on public.sickness_report_events (employee_record_id);
create index sickness_report_events_created_by_idx
  on public.sickness_report_events (created_by);

-- Organization-consistency triggers (P1-06 pattern; SECURITY DEFINER because
-- callers run under RLS that cannot see employee_records).
create or replace function app_private.validate_sickness_report_org()
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
    raise exception 'sickness_report employee record organization mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_sickness_report_event_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.sickness_reports sr
    where sr.id = new.sickness_report_id
      and sr.organization_id = new.organization_id
      and sr.employee_record_id = new.employee_record_id
  ) then
    raise exception 'sickness_report_event report organization mismatch';
  end if;
  return new;
end;
$$;

create trigger sickness_reports_validate
  before insert or update on public.sickness_reports
  for each row execute function app_private.validate_sickness_report_org();

create trigger sickness_reports_updated_at
  before update on public.sickness_reports
  for each row execute function update_updated_at_column();

create trigger sickness_report_events_validate
  before insert or update on public.sickness_report_events
  for each row execute function app_private.validate_sickness_report_event_org();

-- RLS: self-or-manager SELECT via the established SECURITY DEFINER helpers
-- (never subqueries on RLS-protected tables). Writes are service-role only:
-- no INSERT/UPDATE/DELETE policies exist on purpose.
alter table public.sickness_reports enable row level security;
alter table public.sickness_report_events enable row level security;

create policy "Managers and the person can view sickness reports"
  on public.sickness_reports for select
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

create policy "Managers and the person can view sickness report events"
  on public.sickness_report_events for select
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

-- Realtime: full contract for the operational table (org-filtered DELETE
-- events keep their filter column via replica identity full). The append-only
-- events table stays unpublished like other per-domain audit logs.
alter table public.sickness_reports replica identity full;
alter publication supabase_realtime add table public.sickness_reports;
