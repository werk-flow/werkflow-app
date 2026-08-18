-- P1-12 Parkplatz context: jobs.status = 'geparkt' stays the authoritative
-- parked signal; this adds the manager-owned current context (reason,
-- responsible office user, next review) plus append-only history. Existing
-- parked jobs get NO fabricated rows — they surface as a labeled
-- missing-context exception until a manager adds context.

create type job_parking_reason as enum (
  'warten_auf_kunde', 'warten_auf_material', 'warten_auf_freigabe',
  'kapazitaet', 'sonstiges'
);

create table job_parking_contexts (
  job_id uuid primary key references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  reason job_parking_reason not null,
  note text check (note is null or length(note) <= 1000),
  responsible_employee_record_id uuid references employee_records(id) on delete set null,
  next_review_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index job_parking_contexts_org_idx on job_parking_contexts (organization_id);
create index job_parking_contexts_responsible_idx
  on job_parking_contexts (responsible_employee_record_id);
create index job_parking_contexts_review_idx
  on job_parking_contexts (organization_id, next_review_date);
create index job_parking_contexts_created_by_idx on job_parking_contexts (created_by);
create index job_parking_contexts_updated_by_idx on job_parking_contexts (updated_by);

create table job_parking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  event_type text not null check (event_type in ('context_set', 'context_updated', 'unparked')),
  before_state jsonb,
  after_state jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index job_parking_events_org_idx on job_parking_events (organization_id);
create index job_parking_events_job_idx on job_parking_events (job_id);
create index job_parking_events_created_by_idx on job_parking_events (created_by);

create or replace function app_private.validate_job_parking_row_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.jobs j
    where j.id = new.job_id and j.organization_id = new.organization_id
  ) then
    raise exception 'parking row job organization mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_job_parking_context_org
  before insert or update on job_parking_contexts
  for each row execute function app_private.validate_job_parking_row_org();
create trigger validate_job_parking_event_org
  before insert on job_parking_events
  for each row execute function app_private.validate_job_parking_row_org();

create trigger prevent_job_parking_event_change
  before update or delete on job_parking_events
  for each row execute function app_private.prevent_planning_history_change();

-- Unparking clears the current context (history stays in the event ledger),
-- regardless of which mutation path unparked the job.
create or replace function app_private.clear_parking_context_on_unpark()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context record;
begin
  if old.status <> 'geparkt' or new.status = 'geparkt' then
    return null;
  end if;
  select * into v_context from public.job_parking_contexts where job_id = new.id;
  if found then
    delete from public.job_parking_contexts where job_id = new.id;
    insert into public.job_parking_events
      (organization_id, job_id, event_type, before_state, after_state)
    values (
      new.organization_id, new.id, 'unparked',
      jsonb_build_object(
        'reason', v_context.reason::text,
        'note', v_context.note,
        'responsibleEmployeeRecordId', v_context.responsible_employee_record_id,
        'nextReviewDate', v_context.next_review_date
      ),
      jsonb_build_object('jobStatus', new.status::text)
    );
  end if;
  return null;
end;
$$;

create trigger clear_parking_context_on_unpark
  after update of status on jobs
  for each row execute function app_private.clear_parking_context_on_unpark();

alter table job_parking_contexts enable row level security;
alter table job_parking_events enable row level security;

create policy "Managers can view job parking contexts"
  on job_parking_contexts for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

create policy "Managers can view job parking events"
  on job_parking_events for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

alter table job_parking_contexts replica identity full;
alter publication supabase_realtime add table job_parking_contexts;