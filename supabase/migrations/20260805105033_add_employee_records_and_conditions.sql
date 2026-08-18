-- P1-03: employee/personnel identity with date-effective employment conditions.
-- Org-scoped personnel records (independent of the global profiles table),
-- date-effective employment_conditions versions, and an append-only audit log.

create table public.employee_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null = personnel record without an app login (future starter, non-login worker).
  user_id uuid references auth.users(id) on delete set null,
  -- Pending connection to a future login; cleared when the invite is redeemed.
  invite_id uuid references public.organization_invites(id) on delete set null,
  employee_number text,
  -- Name fields are used only while user_id is null; for linked records the
  -- global profile name is authoritative.
  first_name text,
  last_name text,
  phone text,
  private_email text,
  street text,
  postal_code text,
  city text,
  emergency_contact_name text,
  emergency_contact_phone text,
  entry_date date,
  exit_date date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_records_exit_after_entry
    check (exit_date is null or entry_date is null or exit_date >= entry_date)
);

-- One personnel record per person per organization.
create unique index employee_records_org_user_unique
  on public.employee_records (organization_id, user_id)
  where user_id is not null;

-- Manual org-unique employee numbers (MA-NNN suggestion, manual override allowed).
create unique index employee_records_org_number_unique
  on public.employee_records (organization_id, employee_number)
  where employee_number is not null;

create index employee_records_org_idx on public.employee_records (organization_id);
create index employee_records_invite_idx on public.employee_records (invite_id) where invite_id is not null;

create table public.employment_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  valid_from date not null,
  employment_type text not null
    check (employment_type in ('vollzeit', 'teilzeit', 'ausbildung', 'minijob', 'sonstiges')),
  -- Stored now, first consumed by P1-04 (schedules/targets) and P1-06 (vacation).
  weekly_hours numeric(5,2) check (weekly_hours is null or (weekly_hours >= 0 and weekly_hours <= 100)),
  vacation_days_per_year numeric(4,1) check (vacation_days_per_year is null or (vacation_days_per_year >= 0 and vacation_days_per_year <= 100)),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The condition effective on date D is the row with the greatest valid_from <= D.
  constraint employment_conditions_record_valid_from_unique unique (employee_record_id, valid_from)
);

create index employment_conditions_org_idx on public.employment_conditions (organization_id);
create index employment_conditions_record_idx on public.employment_conditions (employee_record_id);

create table public.employee_record_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index employee_record_events_record_idx on public.employee_record_events (employee_record_id, created_at desc);
create index employee_record_events_org_idx on public.employee_record_events (organization_id);

-- RLS: manager-only SELECT; all writes go through service-role server actions.
alter table public.employee_records enable row level security;
alter table public.employment_conditions enable row level security;
alter table public.employee_record_events enable row level security;

create policy "Managers can view employee records in their orgs"
  on public.employee_records for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

create policy "Managers can view employment conditions in their orgs"
  on public.employment_conditions for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

create policy "Managers can view employee record events in their orgs"
  on public.employee_record_events for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

-- Org-integrity validation triggers (service-role writes still pass through these).
create or replace function app_private.validate_employee_record()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.invite_id is not null and (
       tg_op = 'INSERT'
       or old.invite_id is distinct from new.invite_id
       or old.organization_id is distinct from new.organization_id
     ) then
    if not exists (
      select 1 from public.organization_invites i
      where i.id = new.invite_id and i.organization_id = new.organization_id
    ) then
      raise exception 'employee_record invite organization mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger employee_records_validate
  before insert or update on public.employee_records
  for each row execute function app_private.validate_employee_record();

create or replace function app_private.validate_employment_condition_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'employment_condition employee record organization mismatch';
  end if;
  return new;
end;
$$;

create trigger employment_conditions_validate
  before insert or update on public.employment_conditions
  for each row execute function app_private.validate_employment_condition_org();

create or replace function app_private.validate_employee_record_event_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'employee_record_event employee record organization mismatch';
  end if;
  return new;
end;
$$;

create trigger employee_record_events_validate
  before insert or update on public.employee_record_events
  for each row execute function app_private.validate_employee_record_event_org();

-- updated_at maintenance (same helper the other domain tables use).
create trigger employee_records_updated_at
  before update on public.employee_records
  for each row execute function public.update_updated_at_column();

create trigger employment_conditions_updated_at
  before update on public.employment_conditions
  for each row execute function public.update_updated_at_column();

-- Every membership-creation path (org-creation trigger, invite redemption,
-- join-by-code) gets a personnel record automatically.
create or replace function app_private.ensure_employee_record_for_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.employee_records (organization_id, user_id, entry_date)
  select new.organization_id,
         new.user_id,
         (new.joined_at at time zone 'Europe/Berlin')::date
  where not exists (
    select 1 from public.employee_records er
    where er.organization_id = new.organization_id and er.user_id = new.user_id
  );
  return new;
end;
$$;

create trigger organization_members_ensure_employee_record
  after insert on public.organization_members
  for each row execute function app_private.ensure_employee_record_for_member();

-- Additive backfill: every existing member gets a personnel record with the
-- join date as a visible, editable entry-date default. No employee numbers
-- and no employment conditions are invented.
insert into public.employee_records (organization_id, user_id, entry_date)
select m.organization_id,
       m.user_id,
       (m.joined_at at time zone 'Europe/Berlin')::date
from public.organization_members m
where not exists (
  select 1 from public.employee_records er
  where er.organization_id = m.organization_id and er.user_id = m.user_id
);

-- Suggestion RPC for the manual org-unique employee number (durable identity,
-- deliberately without a year segment unlike job/request numbers).
create or replace function public.generate_personnel_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when employee_number ~ '^MA-[0-9]{3,}$'
          then substring(employee_number from 4)::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from employee_records
  where organization_id = p_org_id;

  return 'MA-' || lpad(next_seq::text, 3, '0');
end;
$$;

-- Realtime: manager surfaces refresh on personnel changes; the append-only
-- events table stays unpublished (same as client_request_events).
alter publication supabase_realtime add table public.employee_records;
alter publication supabase_realtime add table public.employment_conditions;