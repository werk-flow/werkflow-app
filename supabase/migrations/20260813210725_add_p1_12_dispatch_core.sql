-- P1-12 dispatch core: versioned dispatch instructions with an exclusive
-- target (one job_visit occurrence XOR one unscheduled job), append-only
-- revisions, employee-record recipients, revision-bound acknowledgements,
-- and transactional supersession triggers.

create type dispatch_status as enum ('active', 'cancelled');
create type dispatch_change_kind as enum (
  'issued', 'schedule_changed', 'reassigned', 'target_scheduled',
  'instruction_changed', 'batch_reschedule'
);
create type dispatch_acknowledgement_state as enum (
  'acknowledged', 'challenged', 'carried_forward'
);

create table planning_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  occurrence_id uuid references planning_occurrences(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  status dispatch_status not null default 'active',
  current_revision_id uuid,
  creation_request_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_dispatches_exclusive_target_check
    check ((occurrence_id is null) <> (job_id is null))
);

create unique index planning_dispatches_active_occurrence_key
  on planning_dispatches (occurrence_id)
  where status = 'active' and occurrence_id is not null;
create unique index planning_dispatches_active_job_key
  on planning_dispatches (job_id)
  where status = 'active' and job_id is not null;
create unique index planning_dispatches_creation_request_key
  on planning_dispatches (organization_id, creation_request_id)
  where creation_request_id is not null;
create index planning_dispatches_org_status_idx
  on planning_dispatches (organization_id, status);
create index planning_dispatches_occurrence_idx on planning_dispatches (occurrence_id);
create index planning_dispatches_job_idx on planning_dispatches (job_id);
create index planning_dispatches_created_by_idx on planning_dispatches (created_by);
create index planning_dispatches_current_revision_idx on planning_dispatches (current_revision_id);

create table planning_dispatch_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispatch_id uuid not null references planning_dispatches(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  change_kind dispatch_change_kind not null,
  occurrence_id uuid references planning_occurrences(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  planned_start_date date,
  planned_end_date_exclusive date,
  location_text text check (location_text is null or length(location_text) <= 1000),
  site_id uuid references client_sites(id) on delete set null,
  dispatch_note text check (dispatch_note is null or length(dispatch_note) <= 2000),
  material_fingerprint text not null check (length(material_fingerprint) = 64),
  readiness_snapshot jsonb,
  readiness_fingerprint text check (readiness_fingerprint is null or length(readiness_fingerprint) = 64),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint planning_dispatch_revisions_target_check
    check ((occurrence_id is null) <> (job_id is null)),
  constraint planning_dispatch_revisions_number_key unique (dispatch_id, revision_number)
);

create index planning_dispatch_revisions_org_idx on planning_dispatch_revisions (organization_id);
create index planning_dispatch_revisions_occurrence_idx on planning_dispatch_revisions (occurrence_id);
create index planning_dispatch_revisions_job_idx on planning_dispatch_revisions (job_id);
create index planning_dispatch_revisions_site_idx on planning_dispatch_revisions (site_id);
create index planning_dispatch_revisions_created_by_idx on planning_dispatch_revisions (created_by);

alter table planning_dispatches
  add constraint planning_dispatches_current_revision_fkey
  foreign key (current_revision_id) references planning_dispatch_revisions(id)
  on delete set null;

create table planning_dispatch_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispatch_id uuid not null references planning_dispatches(id) on delete cascade,
  revision_id uuid not null references planning_dispatch_revisions(id) on delete cascade,
  employee_record_id uuid not null references employee_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint planning_dispatch_recipients_key unique (revision_id, employee_record_id)
);

create index planning_dispatch_recipients_org_idx on planning_dispatch_recipients (organization_id);
create index planning_dispatch_recipients_dispatch_idx on planning_dispatch_recipients (dispatch_id);
create index planning_dispatch_recipients_employee_idx on planning_dispatch_recipients (employee_record_id);

create table planning_dispatch_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispatch_id uuid not null references planning_dispatches(id) on delete cascade,
  revision_id uuid not null references planning_dispatch_revisions(id) on delete cascade,
  employee_record_id uuid not null references employee_records(id) on delete cascade,
  state dispatch_acknowledgement_state not null,
  reason text,
  acted_by uuid references auth.users(id) on delete set null,
  carried_from_acknowledgement_id uuid references planning_dispatch_acknowledgements(id) on delete set null,
  challenge_resolved_at timestamptz,
  challenge_resolved_by uuid references auth.users(id) on delete set null,
  challenge_resolution text check (challenge_resolution in ('kept', 'superseded')),
  challenge_resolution_reason text check (
    challenge_resolution_reason is null
    or (length(btrim(challenge_resolution_reason)) between 3 and 1000)
  ),
  created_at timestamptz not null default now(),
  constraint planning_dispatch_ack_reason_check check (
    state <> 'challenged'
    or (reason is not null and length(btrim(reason)) between 8 and 500)
  ),
  constraint planning_dispatch_ack_resolution_check check (
    state = 'challenged'
    or (challenge_resolved_at is null and challenge_resolution is null)
  )
);

create unique index planning_dispatch_open_challenge_key
  on planning_dispatch_acknowledgements (revision_id, employee_record_id)
  where state = 'challenged' and challenge_resolved_at is null;
create index planning_dispatch_acks_org_idx on planning_dispatch_acknowledgements (organization_id);
create index planning_dispatch_acks_dispatch_idx on planning_dispatch_acknowledgements (dispatch_id);
create index planning_dispatch_acks_revision_idx on planning_dispatch_acknowledgements (revision_id);
create index planning_dispatch_acks_employee_idx on planning_dispatch_acknowledgements (employee_record_id);
create index planning_dispatch_acks_acted_by_idx on planning_dispatch_acknowledgements (acted_by);
create index planning_dispatch_acks_carried_from_idx on planning_dispatch_acknowledgements (carried_from_acknowledgement_id);
create index planning_dispatch_acks_resolved_by_idx on planning_dispatch_acknowledgements (challenge_resolved_by);

create table planning_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dispatch_id uuid not null references planning_dispatches(id) on delete cascade,
  revision_id uuid references planning_dispatch_revisions(id) on delete cascade,
  event_type text not null check (event_type in (
    'issued', 'revision_superseded', 'target_scheduled', 'acknowledged',
    'challenged', 'challenge_resolved', 'cancelled'
  )),
  payload jsonb,
  reason text check (reason is null or (length(btrim(reason)) between 3 and 1000)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index planning_dispatch_events_org_idx on planning_dispatch_events (organization_id);
create index planning_dispatch_events_dispatch_idx on planning_dispatch_events (dispatch_id);
create index planning_dispatch_events_revision_idx on planning_dispatch_events (revision_id);
create index planning_dispatch_events_created_by_idx on planning_dispatch_events (created_by);

-- Organization-consistency validation triggers ------------------------------

create or replace function app_private.validate_planning_dispatch_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.occurrence_id is not null then
    if not exists (
      select 1 from public.planning_occurrences o
      where o.id = new.occurrence_id
        and o.organization_id = new.organization_id
        and o.entry_kind = 'job_visit'
    ) then
      raise exception 'dispatch occurrence organization mismatch or not a job visit';
    end if;
  end if;
  if new.job_id is not null then
    if not exists (
      select 1 from public.jobs j
      where j.id = new.job_id and j.organization_id = new.organization_id
    ) then
      raise exception 'dispatch job organization mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_planning_dispatch_org
  before insert or update on planning_dispatches
  for each row execute function app_private.validate_planning_dispatch_org();

create or replace function app_private.validate_planning_dispatch_child_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.planning_dispatches d
    where d.id = new.dispatch_id and d.organization_id = new.organization_id
  ) then
    raise exception 'dispatch child row organization mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_planning_dispatch_revision_org
  before insert on planning_dispatch_revisions
  for each row execute function app_private.validate_planning_dispatch_child_org();
create trigger validate_planning_dispatch_event_org
  before insert on planning_dispatch_events
  for each row execute function app_private.validate_planning_dispatch_child_org();

create or replace function app_private.validate_planning_dispatch_person_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.planning_dispatches d
    where d.id = new.dispatch_id and d.organization_id = new.organization_id
  ) then
    raise exception 'dispatch person row organization mismatch';
  end if;
  if not exists (
    select 1 from public.planning_dispatch_revisions r
    where r.id = new.revision_id
      and r.dispatch_id = new.dispatch_id
      and r.organization_id = new.organization_id
  ) then
    raise exception 'dispatch revision reference mismatch';
  end if;
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id
      and er.organization_id = new.organization_id
  ) then
    raise exception 'dispatch employee record organization mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_planning_dispatch_recipient_org
  before insert on planning_dispatch_recipients
  for each row execute function app_private.validate_planning_dispatch_person_org();
create trigger validate_planning_dispatch_acknowledgement_org
  before insert on planning_dispatch_acknowledgements
  for each row execute function app_private.validate_planning_dispatch_person_org();

-- Append-only guards --------------------------------------------------------

create trigger prevent_dispatch_revision_change
  before update or delete on planning_dispatch_revisions
  for each row execute function app_private.prevent_planning_history_change();
create trigger prevent_dispatch_recipient_change
  before update or delete on planning_dispatch_recipients
  for each row execute function app_private.prevent_planning_history_change();
create trigger prevent_dispatch_event_change
  before update or delete on planning_dispatch_events
  for each row execute function app_private.prevent_planning_history_change();

-- Acknowledgements: only challenge-resolution fields may change after insert.
create or replace function app_private.guard_dispatch_acknowledgement_update()
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
    raise exception 'dispatch acknowledgements are append-only';
  end if;
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.dispatch_id <> old.dispatch_id
    or new.revision_id <> old.revision_id
    or new.employee_record_id <> old.employee_record_id
    or new.state <> old.state
    or coalesce(new.reason, '') <> coalesce(old.reason, '')
    or new.acted_by is distinct from old.acted_by
    or new.carried_from_acknowledgement_id is distinct from old.carried_from_acknowledgement_id
    or new.created_at <> old.created_at
  then
    raise exception 'only challenge resolution fields may be updated';
  end if;
  if old.challenge_resolved_at is not null then
    raise exception 'challenge is already resolved';
  end if;
  return new;
end;
$$;

create trigger guard_dispatch_acknowledgement_update
  before update or delete on planning_dispatch_acknowledgements
  for each row execute function app_private.guard_dispatch_acknowledgement_update();

-- Material fingerprint ------------------------------------------------------

create or replace function app_private.compute_dispatch_material_fingerprint(
  p_target text,
  p_schedule text,
  p_location text,
  p_site text,
  p_note text,
  p_recipients uuid[]
) returns text
language sql
immutable
set search_path to ''
as $$
  select encode(extensions.digest(
    'target:' || p_target || E'\n'
      || 'schedule:' || p_schedule || E'\n'
      || 'location:' || coalesce(p_location, '') || E'\n'
      || 'site:' || coalesce(p_site, '') || E'\n'
      || 'note:' || coalesce(p_note, '') || E'\n'
      || 'recipients:' || coalesce(
        (select string_agg(r::text, ',' order by r::text) from unnest(p_recipients) r),
        ''
      ),
    'sha256'), 'hex');
$$;

-- Transactional supersession / cancellation sync ----------------------------

-- Idempotent per transaction: recomputes the material fingerprint from the
-- occurrence's final state; a repeat call with an unchanged fingerprint is a
-- no-op, so the deferred per-row triggers below may fire many times safely.
create or replace function app_private.sync_planning_dispatch_for_occurrence(
  p_occurrence_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dispatch record;
  v_occurrence record;
  v_job record;
  v_current record;
  v_recipients uuid[];
  v_fingerprint text;
  v_change_kind public.dispatch_change_kind;
  v_new_revision_id uuid;
  v_actor uuid;
  v_schedule_text text;
  v_location text;
  v_carry boolean;
begin
  select * into v_dispatch
  from public.planning_dispatches
  where occurrence_id = p_occurrence_id and status = 'active'
  for update;
  if not found then
    return;
  end if;

  select * into v_occurrence
  from public.planning_occurrences
  where id = p_occurrence_id;
  if not found then
    return;
  end if;

  v_actor := coalesce(v_occurrence.updated_by, v_occurrence.created_by);

  if v_occurrence.status <> 'scheduled' then
    update public.planning_dispatches
    set status = 'cancelled', updated_at = now()
    where id = v_dispatch.id;
    update public.planning_dispatch_acknowledgements
    set challenge_resolved_at = now(),
        challenge_resolved_by = v_actor,
        challenge_resolution = 'superseded'
    where dispatch_id = v_dispatch.id
      and state = 'challenged'
      and challenge_resolved_at is null;
    insert into public.planning_dispatch_events
      (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
    values (
      v_dispatch.organization_id, v_dispatch.id, v_dispatch.current_revision_id,
      'cancelled',
      jsonb_build_object('cause', 'occurrence_' || v_occurrence.status::text),
      v_actor
    );
    return;
  end if;

  select * into v_job from public.jobs where id = v_occurrence.job_id;

  select coalesce(array_agg(a.employee_record_id), '{}'::uuid[])
  into v_recipients
  from public.planning_occurrence_assignments a
  where a.occurrence_id = p_occurrence_id;

  select * into v_current
  from public.planning_dispatch_revisions
  where id = v_dispatch.current_revision_id;
  if not found then
    return;
  end if;

  v_schedule_text := coalesce(
    v_occurrence.start_at::text || '/' || v_occurrence.end_at::text,
    v_occurrence.start_date::text || '/' || v_occurrence.end_date_exclusive::text,
    'unscheduled'
  );
  v_location := coalesce(v_occurrence.location, v_job.location);

  v_fingerprint := app_private.compute_dispatch_material_fingerprint(
    'occurrence:' || v_occurrence.id::text,
    v_schedule_text,
    v_location,
    v_job.site_id::text,
    v_current.dispatch_note,
    v_recipients
  );
  if v_fingerprint = v_current.material_fingerprint then
    return;
  end if;

  if v_occurrence.start_at is distinct from v_current.planned_start_at
    or v_occurrence.end_at is distinct from v_current.planned_end_at
    or v_occurrence.start_date is distinct from v_current.planned_start_date
    or v_occurrence.end_date_exclusive is distinct from v_current.planned_end_date_exclusive
  then
    v_change_kind := 'schedule_changed';
  elsif v_location is distinct from v_current.location_text then
    v_change_kind := 'instruction_changed';
  else
    v_change_kind := 'reassigned';
  end if;
  -- Only a pure recipient-set change carries unchanged recipients forward.
  v_carry := v_change_kind = 'reassigned';

  insert into public.planning_dispatch_revisions (
    organization_id, dispatch_id, revision_number, change_kind,
    occurrence_id, job_id,
    planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive,
    location_text, site_id, dispatch_note, material_fingerprint,
    created_by
  ) values (
    v_dispatch.organization_id, v_dispatch.id, v_current.revision_number + 1,
    v_change_kind,
    v_occurrence.id, null,
    v_occurrence.start_at, v_occurrence.end_at,
    v_occurrence.start_date, v_occurrence.end_date_exclusive,
    v_location, v_job.site_id, v_current.dispatch_note, v_fingerprint,
    v_actor
  ) returning id into v_new_revision_id;

  insert into public.planning_dispatch_recipients
    (organization_id, dispatch_id, revision_id, employee_record_id)
  select v_dispatch.organization_id, v_dispatch.id, v_new_revision_id, r
  from unnest(v_recipients) r;

  if v_carry then
    insert into public.planning_dispatch_acknowledgements (
      organization_id, dispatch_id, revision_id, employee_record_id,
      state, acted_by, carried_from_acknowledgement_id
    )
    select
      v_dispatch.organization_id, v_dispatch.id, v_new_revision_id,
      latest.employee_record_id, 'carried_forward', v_actor, latest.id
    from (
      select distinct on (a.employee_record_id) a.*
      from public.planning_dispatch_acknowledgements a
      where a.revision_id = v_current.id
      order by a.employee_record_id, a.created_at desc, a.id desc
    ) latest
    where latest.state in ('acknowledged', 'carried_forward')
      and latest.employee_record_id = any (v_recipients);
  end if;

  update public.planning_dispatch_acknowledgements
  set challenge_resolved_at = now(),
      challenge_resolved_by = v_actor,
      challenge_resolution = 'superseded'
  where revision_id = v_current.id
    and state = 'challenged'
    and challenge_resolved_at is null;

  update public.planning_dispatches
  set current_revision_id = v_new_revision_id, updated_at = now()
  where id = v_dispatch.id;

  insert into public.planning_dispatch_events
    (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
  values (
    v_dispatch.organization_id, v_dispatch.id, v_new_revision_id,
    'revision_superseded',
    jsonb_build_object(
      'changeKind', v_change_kind::text,
      'previousRevisionId', v_current.id,
      'carriedForward', v_carry
    ),
    v_actor
  );
end;
$$;

create or replace function app_private.sync_dispatch_on_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform app_private.sync_planning_dispatch_for_occurrence(new.id);
  return null;
end;
$$;

create constraint trigger sync_dispatch_on_occurrence_change
  after update of start_at, end_at, start_date, end_date_exclusive, location, status, job_id
  on planning_occurrences
  deferrable initially deferred
  for each row execute function app_private.sync_dispatch_on_occurrence_change();

create or replace function app_private.sync_dispatch_on_assignment_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_occurrence_id uuid;
begin
  v_occurrence_id := coalesce(new.occurrence_id, old.occurrence_id);
  if exists (select 1 from public.planning_occurrences where id = v_occurrence_id) then
    perform app_private.sync_planning_dispatch_for_occurrence(v_occurrence_id);
  end if;
  return null;
end;
$$;

create constraint trigger sync_dispatch_on_assignment_change
  after insert or delete on planning_occurrence_assignments
  deferrable initially deferred
  for each row execute function app_private.sync_dispatch_on_assignment_change();

-- Retarget a job-targeted (unscheduled) dispatch when the job gains its first
-- scheduled visit: a traceable target transition on the same dispatch identity.
create or replace function app_private.retarget_dispatch_on_occurrence_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dispatch record;
  v_occurrence record;
  v_job record;
  v_recipients uuid[];
  v_current record;
  v_fingerprint text;
  v_new_revision_id uuid;
  v_actor uuid;
begin
  if new.job_id is null or new.entry_kind <> 'job_visit' or new.status <> 'scheduled' then
    return null;
  end if;
  select * into v_occurrence from public.planning_occurrences where id = new.id;
  if not found or v_occurrence.status <> 'scheduled' then
    return null;
  end if;
  select * into v_dispatch
  from public.planning_dispatches
  where job_id = v_occurrence.job_id and status = 'active'
  for update;
  if not found then
    return null;
  end if;

  select * into v_job from public.jobs where id = v_occurrence.job_id;
  select * into v_current
  from public.planning_dispatch_revisions
  where id = v_dispatch.current_revision_id;
  if not found then
    return null;
  end if;
  v_actor := coalesce(v_occurrence.created_by, v_occurrence.updated_by);

  select coalesce(array_agg(a.employee_record_id), '{}'::uuid[])
  into v_recipients
  from public.planning_occurrence_assignments a
  where a.occurrence_id = v_occurrence.id;

  v_fingerprint := app_private.compute_dispatch_material_fingerprint(
    'occurrence:' || v_occurrence.id::text,
    coalesce(
      v_occurrence.start_at::text || '/' || v_occurrence.end_at::text,
      v_occurrence.start_date::text || '/' || v_occurrence.end_date_exclusive::text,
      'unscheduled'
    ),
    coalesce(v_occurrence.location, v_job.location),
    v_job.site_id::text,
    v_current.dispatch_note,
    v_recipients
  );

  update public.planning_dispatches
  set occurrence_id = v_occurrence.id, job_id = null, updated_at = now()
  where id = v_dispatch.id;

  insert into public.planning_dispatch_revisions (
    organization_id, dispatch_id, revision_number, change_kind,
    occurrence_id, job_id,
    planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive,
    location_text, site_id, dispatch_note, material_fingerprint,
    created_by
  ) values (
    v_dispatch.organization_id, v_dispatch.id, v_current.revision_number + 1,
    'target_scheduled',
    v_occurrence.id, null,
    v_occurrence.start_at, v_occurrence.end_at,
    v_occurrence.start_date, v_occurrence.end_date_exclusive,
    coalesce(v_occurrence.location, v_job.location), v_job.site_id,
    v_current.dispatch_note, v_fingerprint,
    v_actor
  ) returning id into v_new_revision_id;

  insert into public.planning_dispatch_recipients
    (organization_id, dispatch_id, revision_id, employee_record_id)
  select v_dispatch.organization_id, v_dispatch.id, v_new_revision_id, r
  from unnest(v_recipients) r;

  update public.planning_dispatch_acknowledgements
  set challenge_resolved_at = now(),
      challenge_resolved_by = v_actor,
      challenge_resolution = 'superseded'
  where revision_id = v_current.id
    and state = 'challenged'
    and challenge_resolved_at is null;

  update public.planning_dispatches
  set current_revision_id = v_new_revision_id
  where id = v_dispatch.id;

  insert into public.planning_dispatch_events
    (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
  values (
    v_dispatch.organization_id, v_dispatch.id, v_new_revision_id,
    'target_scheduled',
    jsonb_build_object('previousRevisionId', v_current.id, 'occurrenceId', v_occurrence.id),
    v_actor
  );
  return null;
end;
$$;

create constraint trigger retarget_dispatch_on_occurrence_insert
  after insert on planning_occurrences
  deferrable initially deferred
  for each row execute function app_private.retarget_dispatch_on_occurrence_insert();

-- Parking a job voids its work instructions: cancel active dispatches for the
-- job and for its occurrences, visibly, in the same transaction.
create or replace function app_private.cancel_dispatches_on_job_parked()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dispatch record;
begin
  if new.status <> 'geparkt' or old.status = 'geparkt' then
    return null;
  end if;
  for v_dispatch in
    select d.*
    from public.planning_dispatches d
    where d.status = 'active'
      and (
        d.job_id = new.id
        or d.occurrence_id in (
          select o.id from public.planning_occurrences o where o.job_id = new.id
        )
      )
    for update
  loop
    update public.planning_dispatches
    set status = 'cancelled', updated_at = now()
    where id = v_dispatch.id;
    update public.planning_dispatch_acknowledgements
    set challenge_resolved_at = now(),
        challenge_resolution = 'superseded'
    where dispatch_id = v_dispatch.id
      and state = 'challenged'
      and challenge_resolved_at is null;
    insert into public.planning_dispatch_events
      (organization_id, dispatch_id, revision_id, event_type, payload)
    values (
      v_dispatch.organization_id, v_dispatch.id, v_dispatch.current_revision_id,
      'cancelled', jsonb_build_object('cause', 'job_parked')
    );
  end loop;
  return null;
end;
$$;

create trigger cancel_dispatches_on_job_parked
  after update of status on jobs
  for each row execute function app_private.cancel_dispatches_on_job_parked();

-- RLS ------------------------------------------------------------------------

alter table planning_dispatches enable row level security;
alter table planning_dispatch_revisions enable row level security;
alter table planning_dispatch_recipients enable row level security;
alter table planning_dispatch_acknowledgements enable row level security;
alter table planning_dispatch_events enable row level security;

create policy "Managers and current recipients can view dispatches"
  on planning_dispatches for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or exists (
      select 1 from planning_dispatch_recipients r
      where r.dispatch_id = planning_dispatches.id
        and r.revision_id = planning_dispatches.current_revision_id
        and r.employee_record_id in (
          select app_private.get_user_employee_record_ids((select auth.uid()))
        )
    )
  );

create policy "Managers and current recipients can view dispatch revisions"
  on planning_dispatch_revisions for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or (
      exists (
        select 1 from planning_dispatches d
        where d.id = planning_dispatch_revisions.dispatch_id
          and d.current_revision_id = planning_dispatch_revisions.id
      )
      and exists (
        select 1 from planning_dispatch_recipients r
        where r.revision_id = planning_dispatch_revisions.id
          and r.employee_record_id in (
            select app_private.get_user_employee_record_ids((select auth.uid()))
          )
      )
    )
  );

create policy "Managers and the recipient can view dispatch recipients"
  on planning_dispatch_recipients for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

create policy "Managers and the recipient can view dispatch acknowledgements"
  on planning_dispatch_acknowledgements for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or employee_record_id in (
      select app_private.get_user_employee_record_ids((select auth.uid()))
    )
  );

create policy "Managers can view dispatch events"
  on planning_dispatch_events for select to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

-- Realtime -------------------------------------------------------------------

alter table planning_dispatches replica identity full;
alter table planning_dispatch_recipients replica identity full;
alter table planning_dispatch_acknowledgements replica identity full;

alter publication supabase_realtime add table planning_dispatches;
alter publication supabase_realtime add table planning_dispatch_recipients;
alter publication supabase_realtime add table planning_dispatch_acknowledgements;