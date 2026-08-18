-- P1-12 customer commitments: an explicitly recorded, occurrence-scoped fact
-- ("this window was agreed with the customer via this channel by this office
-- user at this time"). Schedule moves NEVER rewrite a commitment — a mismatch
-- surfaces as a required explicit action. Nothing here sends a message and no
-- delivery/consent/legal conclusion is represented (P1-46 owns delivery).

create type customer_commitment_source as enum (
  'telefonisch', 'vor_ort', 'schriftlich_manuell', 'sonstige'
);
create type customer_commitment_status as enum ('active', 'superseded', 'withdrawn');

create table planning_customer_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  occurrence_id uuid not null references planning_occurrences(id) on delete cascade,
  committed_date date not null,
  window_start_time time,
  window_end_time time,
  source customer_commitment_source not null,
  contact_id uuid references client_contacts(id) on delete set null,
  status customer_commitment_status not null default 'active',
  supersedes_id uuid references planning_customer_commitments(id) on delete set null,
  withdrawal_reason text check (
    withdrawal_reason is null or (length(btrim(withdrawal_reason)) between 3 and 1000)
  ),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  status_changed_by uuid references auth.users(id) on delete set null,
  status_changed_at timestamptz,
  constraint customer_commitment_window_check check (
    (window_start_time is null and window_end_time is null)
    or (window_start_time is not null and window_end_time is not null
        and window_end_time > window_start_time)
  ),
  constraint customer_commitment_withdrawal_check check (
    (status = 'withdrawn') = (withdrawal_reason is not null)
  )
);

create unique index planning_customer_commitments_active_key
  on planning_customer_commitments (occurrence_id)
  where status = 'active';
create index planning_customer_commitments_org_idx
  on planning_customer_commitments (organization_id);
create index planning_customer_commitments_occurrence_idx
  on planning_customer_commitments (occurrence_id);
create index planning_customer_commitments_contact_idx
  on planning_customer_commitments (contact_id);
create index planning_customer_commitments_supersedes_idx
  on planning_customer_commitments (supersedes_id);
create index planning_customer_commitments_recorded_by_idx
  on planning_customer_commitments (recorded_by);
create index planning_customer_commitments_status_changed_by_idx
  on planning_customer_commitments (status_changed_by);

create table planning_customer_commitment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  commitment_id uuid not null references planning_customer_commitments(id) on delete cascade,
  event_type text not null check (event_type in ('recorded', 'superseded', 'withdrawn')),
  payload jsonb,
  reason text check (reason is null or (length(btrim(reason)) between 3 and 1000)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index planning_customer_commitment_events_org_idx
  on planning_customer_commitment_events (organization_id);
create index planning_customer_commitment_events_commitment_idx
  on planning_customer_commitment_events (commitment_id);
create index planning_customer_commitment_events_created_by_idx
  on planning_customer_commitment_events (created_by);

create or replace function app_private.validate_customer_commitment_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job_client_id uuid;
begin
  select j.client_id into v_job_client_id
  from public.planning_occurrences o
  join public.jobs j on j.id = o.job_id
  where o.id = new.occurrence_id
    and o.organization_id = new.organization_id
    and o.entry_kind = 'job_visit';
  if not found then
    raise exception 'commitment occurrence organization mismatch or not a job visit';
  end if;
  if new.contact_id is not null then
    if v_job_client_id is null or not exists (
      select 1 from public.client_contacts c
      where c.id = new.contact_id
        and c.organization_id = new.organization_id
        and c.client_id = v_job_client_id
    ) then
      raise exception 'commitment contact does not belong to the job client';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_customer_commitment_org
  before insert or update on planning_customer_commitments
  for each row execute function app_private.validate_customer_commitment_org();

create or replace function app_private.validate_customer_commitment_event_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.planning_customer_commitments c
    where c.id = new.commitment_id and c.organization_id = new.organization_id
  ) then
    raise exception 'commitment event organization mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_customer_commitment_event_org
  before insert on planning_customer_commitment_events
  for each row execute function app_private.validate_customer_commitment_event_org();

create trigger prevent_customer_commitment_event_change
  before update or delete on planning_customer_commitment_events
  for each row execute function app_private.prevent_planning_history_change();

-- Commitment rows themselves are terminal-transition-only: the recorded fact
-- never mutates; only the status lifecycle fields may change once.
create or replace function app_private.guard_customer_commitment_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.organizations where id = old.organization_id
    ) then
      return old;
    end if;
    raise exception 'customer commitments are append-only';
  end if;
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.occurrence_id <> old.occurrence_id
    or new.committed_date <> old.committed_date
    or new.window_start_time is distinct from old.window_start_time
    or new.window_end_time is distinct from old.window_end_time
    or new.source <> old.source
    or new.contact_id is distinct from old.contact_id
    or new.supersedes_id is distinct from old.supersedes_id
    or new.recorded_by is distinct from old.recorded_by
    or new.recorded_at <> old.recorded_at
  then
    raise exception 'recorded commitment facts are immutable';
  end if;
  if old.status <> 'active' then
    raise exception 'commitment is already in a terminal state';
  end if;
  return new;
end;
$$;

create trigger guard_customer_commitment_update
  before update or delete on planning_customer_commitments
  for each row execute function app_private.guard_customer_commitment_update();

alter table planning_customer_commitments enable row level security;
alter table planning_customer_commitment_events enable row level security;

create policy "Managers can view customer commitments"
  on planning_customer_commitments for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

create policy "Managers can view customer commitment events"
  on planning_customer_commitment_events for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

alter table planning_customer_commitments replica identity full;
alter publication supabase_realtime add table planning_customer_commitments;