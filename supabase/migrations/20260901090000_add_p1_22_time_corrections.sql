-- P1-22: one attributable correction lifecycle for legacy and canonical time.
-- Existing time facts and legacy change requests remain unchanged. Pending
-- proposals never mutate their sources.

create type public.time_correction_kind as enum (
  'add', 'edit', 'delete', 'split', 'reclassify', 'reallocate',
  'reassign', 'missed_clock'
);

create type public.time_correction_status as enum (
  'submitted', 'clarification_required', 'approved', 'rejected',
  'withdrawn', 'application_failed'
);

create type public.time_correction_source_kind as enum (
  'legacy_entry', 'canonical_session', 'canonical_segment',
  'correction_application'
);

create type public.time_correction_event_type as enum (
  'submitted', 'clarification_requested', 'resubmitted', 'approved',
  'rejected', 'withdrawn', 'application_failed'
);

create table public.time_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_employee_record_id uuid not null,
  subject_user_id uuid not null,
  requested_by uuid not null,
  kind public.time_correction_kind not null,
  status public.time_correction_status not null default 'submitted',
  current_revision bigint not null default 1 check (current_revision > 0),
  source_scope_key text not null check (source_scope_key ~ '^[0-9a-f]{64}$'),
  reviewed_by uuid,
  reviewed_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_correction_requests_subject_org_fkey
    foreign key (subject_employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_correction_requests_decision_shape_check check (
    (
      status in ('submitted', 'clarification_required')
      and reviewed_by is null and reviewed_at is null
    ) or (
      status in ('approved', 'rejected', 'application_failed')
      and reviewed_by is not null and reviewed_at is not null
    ) or status = 'withdrawn'
  ),
  constraint time_correction_requests_comment_shape_check check (
    status not in ('clarification_required', 'rejected')
    or nullif(btrim(decision_comment), '') is not null
  )
);

create unique index time_correction_requests_replident_idx
  on public.time_correction_requests(id, organization_id);
create index time_correction_requests_org_status_created_idx
  on public.time_correction_requests(organization_id, status, created_at desc, id desc);
create index time_correction_requests_subject_created_idx
  on public.time_correction_requests(
    organization_id, subject_employee_record_id, created_at desc, id desc
  );
create unique index time_correction_requests_open_scope_unique
  on public.time_correction_requests(organization_id, source_scope_key)
  where status in ('submitted', 'clarification_required');

create table public.time_correction_request_revisions (
  request_id uuid not null,
  organization_id uuid not null,
  revision bigint not null check (revision > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null,
  proposed_snapshot jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (request_id, revision),
  constraint time_correction_revisions_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_correction_requests(id, organization_id) on delete cascade,
  constraint time_correction_revisions_snapshot_shape_check check (
    jsonb_typeof(before_snapshot) = 'object'
    and jsonb_typeof(proposed_snapshot) = 'object'
    and before_snapshot ? 'schemaVersion'
    and before_snapshot ? 'facts'
    and proposed_snapshot ? 'schemaVersion'
    and proposed_snapshot ? 'facts'
  )
);

create index time_correction_revisions_org_created_idx
  on public.time_correction_request_revisions(organization_id, created_at desc);

create table public.time_correction_request_sources (
  request_id uuid not null,
  organization_id uuid not null,
  revision bigint not null,
  ordinal integer not null check (ordinal >= 0),
  source_kind public.time_correction_source_kind not null,
  time_entry_id uuid,
  time_session_id uuid,
  time_segment_id uuid,
  correction_application_id uuid,
  source_version text not null,
  primary key (request_id, revision, ordinal),
  constraint time_correction_sources_revision_fkey
    foreign key (request_id, revision)
    references public.time_correction_request_revisions(request_id, revision)
    on delete cascade,
  constraint time_correction_sources_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_correction_requests(id, organization_id) on delete cascade,
  constraint time_correction_sources_entry_org_fkey
    foreign key (time_entry_id, organization_id)
    references public.time_entries(id, organization_id) on delete restrict,
  constraint time_correction_sources_session_org_fkey
    foreign key (time_session_id, organization_id)
    references public.time_sessions(id, organization_id) on delete restrict,
  constraint time_correction_sources_segment_org_fkey
    foreign key (time_segment_id, organization_id)
    references public.time_segments(id, organization_id) on delete restrict,
  constraint time_correction_sources_shape_check check (
    (source_kind = 'legacy_entry' and time_entry_id is not null
      and time_session_id is null and time_segment_id is null
      and correction_application_id is null)
    or (source_kind = 'canonical_session' and time_entry_id is null
      and time_session_id is not null and time_segment_id is null
      and correction_application_id is null)
    or (source_kind = 'canonical_segment' and time_entry_id is null
      and time_session_id is null and time_segment_id is not null
      and correction_application_id is null)
    or (source_kind = 'correction_application' and time_entry_id is null
      and time_session_id is null and time_segment_id is null
      and correction_application_id is not null)
  )
);

create index time_correction_sources_entry_idx
  on public.time_correction_request_sources(time_entry_id, organization_id)
  where time_entry_id is not null;
create index time_correction_sources_session_idx
  on public.time_correction_request_sources(time_session_id, organization_id)
  where time_session_id is not null;
create index time_correction_sources_segment_idx
  on public.time_correction_request_sources(time_segment_id, organization_id)
  where time_segment_id is not null;
create index time_correction_sources_application_idx
  on public.time_correction_request_sources(correction_application_id)
  where correction_application_id is not null;

create table public.time_correction_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  revision bigint not null,
  event_type public.time_correction_event_type not null,
  actor_id uuid not null,
  operation_id uuid not null unique,
  comment text,
  responsibility_snapshot jsonb,
  occurred_at timestamptz not null default now(),
  constraint time_correction_events_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_correction_requests(id, organization_id) on delete cascade
);

create index time_correction_events_request_occurred_idx
  on public.time_correction_events(request_id, occurred_at, id);
create index time_correction_events_org_occurred_idx
  on public.time_correction_events(organization_id, occurred_at desc, id desc);

create table public.time_correction_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null unique,
  revision bigint not null,
  applied_by uuid not null,
  operation_id uuid not null unique,
  previous_application_id uuid,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null,
  applied_snapshot jsonb not null,
  responsibility_snapshot jsonb not null,
  applied_at timestamptz not null default now(),
  constraint time_correction_applications_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_correction_requests(id, organization_id) on delete restrict,
  constraint time_correction_applications_revision_fkey
    foreign key (request_id, revision)
    references public.time_correction_request_revisions(request_id, revision) on delete restrict,
  constraint time_correction_applications_previous_fkey
    foreign key (previous_application_id)
    references public.time_correction_applications(id) on delete restrict
);

create index time_correction_applications_org_applied_idx
  on public.time_correction_applications(organization_id, applied_at desc, id desc);

alter table public.time_correction_request_sources
  add constraint time_correction_sources_application_fkey
  foreign key (correction_application_id)
  references public.time_correction_applications(id) on delete restrict;

create or replace function app_private.guard_time_correction_immutable()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  raise exception 'time_correction_history_immutable';
end;
$$;

-- History rows are update-proof at the database boundary. Deletes are not
-- granted to application roles, while retaining organization cascade cleanup.
create trigger guard_time_correction_revisions_immutable
before update on public.time_correction_request_revisions
for each row execute function app_private.guard_time_correction_immutable();
create trigger guard_time_correction_sources_immutable
before update on public.time_correction_request_sources
for each row execute function app_private.guard_time_correction_immutable();
create trigger guard_time_correction_events_immutable
before update on public.time_correction_events
for each row execute function app_private.guard_time_correction_immutable();
create trigger guard_time_correction_applications_immutable
before update on public.time_correction_applications
for each row execute function app_private.guard_time_correction_immutable();

create trigger time_correction_requests_updated_at
before update on public.time_correction_requests
for each row execute function public.update_time_entries_updated_at();

create or replace function app_private.is_time_approval_holder(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_actor_employee_id uuid;
  v_latest_configuration_id uuid;
  v_direct boolean := false;
  v_role_source public.org_role;
begin
  if p_actor_id = p_target_user_id then return false; end if;

  select role into v_actor_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_id;
  select role into v_target_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id;
  select id into v_actor_employee_id
  from public.employee_records
  where organization_id = p_organization_id and user_id = p_actor_id;

  if v_actor_role is null or v_target_role is null or v_actor_employee_id is null then
    return false;
  end if;

  select id into v_latest_configuration_id
  from public.organization_responsibility_configurations
  where organization_id = p_organization_id
    and responsibility = 'time_approval'
    and effective_from <= clock_timestamp()
  order by effective_from desc, created_at desc, id desc
  limit 1;

  if v_latest_configuration_id is null then
    return v_actor_role = 'admin'
      or (v_actor_role = 'buero' and v_target_role = 'employee');
  end if;

  select assignment.source = 'direct', assignment.role_snapshot
    into v_direct, v_role_source
  from public.organization_responsibility_assignments assignment
  where assignment.configuration_id = v_latest_configuration_id
    and assignment.organization_id = p_organization_id
    and assignment.employee_record_id = v_actor_employee_id
  limit 1;

  if found then
    return v_direct or v_role_source = 'admin'
      or (v_role_source = 'buero' and v_target_role = 'employee');
  end if;

  select assignment.source = 'direct', assignment.role_snapshot
    into v_direct, v_role_source
  from public.organization_responsibility_delegations delegation
  join public.organization_responsibility_assignments assignment
    on assignment.organization_id = delegation.organization_id
   and assignment.configuration_id = v_latest_configuration_id
   and assignment.employee_record_id = delegation.delegator_employee_record_id
  where delegation.organization_id = p_organization_id
    and delegation.responsibility = 'time_approval'
    and delegation.substitute_employee_record_id = v_actor_employee_id
    and delegation.valid_from <= current_date
    and delegation.valid_until >= current_date
    and (delegation.revoked_from is null or delegation.revoked_from > current_date)
  order by delegation.valid_from desc, delegation.id
  limit 1;

  return found and (
    v_direct or v_role_source = 'admin'
    or (v_role_source = 'buero' and v_target_role = 'employee')
  );
end;
$$;

create or replace function app_private.assert_time_correction_sources_current(
  p_request_id uuid,
  p_revision bigint
)
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_source public.time_correction_request_sources%rowtype;
  v_actual text;
begin
  for v_source in
    select * from public.time_correction_request_sources
    where request_id = p_request_id and revision = p_revision
    order by ordinal
  loop
    if v_source.source_kind = 'legacy_entry' then
      select updated_at::text into v_actual from public.time_entries
      where id = v_source.time_entry_id and organization_id = v_source.organization_id
      for update;
    elsif v_source.source_kind = 'canonical_session' then
      select version::text into v_actual from public.time_sessions
      where id = v_source.time_session_id and organization_id = v_source.organization_id
      for update;
    elsif v_source.source_kind = 'canonical_segment' then
      select updated_at::text into v_actual from public.time_segments
      where id = v_source.time_segment_id and organization_id = v_source.organization_id
      for update;
    else
      select source_fingerprint into v_actual
      from public.time_correction_applications
      where id = v_source.correction_application_id
        and organization_id = v_source.organization_id
      for update;
    end if;
    if v_actual is null or v_actual <> v_source.source_version then
      raise exception 'time_correction_stale_source';
    end if;
  end loop;
end;
$$;

create or replace function public.create_time_correction_request(
  p_organization_id uuid,
  p_subject_employee_record_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_reason text,
  p_source_scope_key text,
  p_source_fingerprint text,
  p_before_snapshot jsonb,
  p_proposed_snapshot jsonb,
  p_sources jsonb,
  p_responsibility_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request_id uuid;
  v_application_id uuid;
  v_previous_application_id uuid;
  v_subject_user_id uuid;
  v_source jsonb;
  v_source_kind public.time_correction_source_kind;
  v_source_id uuid;
  v_source_version text;
  v_actual_version text;
  v_actual_employee_id uuid;
  v_ordinal integer := 0;
  v_apply_immediately boolean;
  v_existing public.time_correction_events%rowtype;
begin
  if p_actor_id is null or p_operation_id is null
    or p_organization_id is null or p_subject_employee_record_id is null
    or nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) not between 3 and 2000
    or p_source_scope_key !~ '^[0-9a-f]{64}$'
    or p_source_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_before_snapshot) <> 'object'
    or jsonb_typeof(p_before_snapshot -> 'facts') <> 'array'
    or jsonb_typeof(p_proposed_snapshot) <> 'object'
    or jsonb_typeof(p_proposed_snapshot -> 'facts') <> 'array'
    or jsonb_typeof(p_sources) <> 'array'
  then raise exception 'time_correction_invalid_input'; end if;

  select * into v_existing from public.time_correction_events
  where operation_id = p_operation_id;
  if found then
    return jsonb_build_object(
      'requestId', v_existing.request_id,
      'status', case when v_existing.event_type = 'approved'
        then 'approved' else 'submitted' end,
      'replayed', true
    );
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_actor_id
  ) then raise exception 'time_correction_not_a_member'; end if;

  select user_id into v_subject_user_id
  from public.employee_records
  where id = p_subject_employee_record_id
    and organization_id = p_organization_id;
  if v_subject_user_id is null then
    raise exception 'time_correction_subject_missing';
  end if;

  v_apply_immediately := p_actor_id <> v_subject_user_id
    and app_private.is_time_approval_holder(
      p_organization_id, p_actor_id, v_subject_user_id
    );
  if p_actor_id <> v_subject_user_id and not v_apply_immediately then
    raise exception 'time_correction_not_responsible';
  end if;

  if p_kind not in (
    'add', 'edit', 'delete', 'split', 'reclassify', 'reallocate',
    'reassign', 'missed_clock'
  ) then raise exception 'time_correction_invalid_kind'; end if;
  if p_kind in ('add', 'missed_clock')
    and jsonb_array_length(p_sources) <> 0
  then raise exception 'time_correction_sources_invalid'; end if;
  if p_kind not in ('add', 'missed_clock')
    and jsonb_array_length(p_sources) = 0
  then raise exception 'time_correction_sources_required'; end if;

  insert into public.time_correction_requests (
    organization_id, subject_employee_record_id, subject_user_id,
    requested_by, kind, status, source_scope_key, reviewed_by, reviewed_at
  ) values (
    p_organization_id, p_subject_employee_record_id, v_subject_user_id,
    p_actor_id, p_kind::public.time_correction_kind,
    case when v_apply_immediately then 'approved'::public.time_correction_status
      else 'submitted'::public.time_correction_status end,
    p_source_scope_key,
    case when v_apply_immediately then p_actor_id else null end,
    case when v_apply_immediately then clock_timestamp() else null end
  ) returning id into v_request_id;

  insert into public.time_correction_request_revisions (
    request_id, organization_id, revision, reason, source_fingerprint,
    before_snapshot, proposed_snapshot, created_by
  ) values (
    v_request_id, p_organization_id, 1, btrim(p_reason),
    p_source_fingerprint, p_before_snapshot, p_proposed_snapshot, p_actor_id
  );

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    begin
      v_source_kind := (v_source ->> 'kind')::public.time_correction_source_kind;
      v_source_id := (v_source ->> 'id')::uuid;
      v_source_version := v_source ->> 'version';
    exception when others then
      raise exception 'time_correction_source_invalid';
    end;
    if v_source_version is null then
      raise exception 'time_correction_source_invalid';
    end if;

    if v_source_kind = 'legacy_entry' then
      select entry.updated_at::text, employee.id
        into v_actual_version, v_actual_employee_id
      from public.time_entries entry
      join public.employee_records employee
        on employee.organization_id = entry.organization_id
       and employee.user_id = entry.user_id
      where entry.id = v_source_id
        and entry.organization_id = p_organization_id;
    elsif v_source_kind = 'canonical_session' then
      select version::text, employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_sessions
      where id = v_source_id and organization_id = p_organization_id;
    elsif v_source_kind = 'canonical_segment' then
      select updated_at::text, employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_segments
      where id = v_source_id and organization_id = p_organization_id;
    else
      select application.source_fingerprint, request.subject_employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_correction_applications application
      join public.time_correction_requests request on request.id = application.request_id
      where application.id = v_source_id
        and application.organization_id = p_organization_id;
      if v_previous_application_id is not null then
        raise exception 'time_correction_multiple_application_sources';
      end if;
      v_previous_application_id := v_source_id;
    end if;
    if v_actual_version is null or v_actual_employee_id <> p_subject_employee_record_id
      or v_actual_version <> v_source_version
    then raise exception 'time_correction_source_stale_or_wrong_subject'; end if;

    insert into public.time_correction_request_sources (
      request_id, organization_id, revision, ordinal, source_kind,
      time_entry_id, time_session_id, time_segment_id,
      correction_application_id, source_version
    ) values (
      v_request_id, p_organization_id, 1, v_ordinal, v_source_kind,
      case when v_source_kind = 'legacy_entry' then v_source_id end,
      case when v_source_kind = 'canonical_session' then v_source_id end,
      case when v_source_kind = 'canonical_segment' then v_source_id end,
      case when v_source_kind = 'correction_application' then v_source_id end,
      v_source_version
    );
    v_ordinal := v_ordinal + 1;
  end loop;

  if v_apply_immediately then
    insert into public.time_correction_applications (
      organization_id, request_id, revision, applied_by, operation_id,
      previous_application_id, source_fingerprint, before_snapshot,
      applied_snapshot, responsibility_snapshot
    ) values (
      p_organization_id, v_request_id, 1, p_actor_id, p_operation_id,
      v_previous_application_id, p_source_fingerprint, p_before_snapshot,
      p_proposed_snapshot, coalesce(p_responsibility_snapshot, '{}'::jsonb)
    ) returning id into v_application_id;
    insert into public.time_correction_events (
      organization_id, request_id, revision, event_type, actor_id,
      operation_id, responsibility_snapshot
    ) values (
      p_organization_id, v_request_id, 1, 'approved', p_actor_id,
      p_operation_id, coalesce(p_responsibility_snapshot, '{}'::jsonb)
    );
  else
    insert into public.time_correction_events (
      organization_id, request_id, revision, event_type, actor_id, operation_id
    ) values (
      p_organization_id, v_request_id, 1, 'submitted', p_actor_id, p_operation_id
    );
  end if;

  return jsonb_build_object(
    'requestId', v_request_id, 'applicationId', v_application_id,
    'status', case when v_apply_immediately then 'approved' else 'submitted' end,
    'replayed', false
  );
end;
$$;

create or replace function public.revise_time_correction_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_source_scope_key text,
  p_source_fingerprint text,
  p_before_snapshot jsonb,
  p_proposed_snapshot jsonb,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.time_correction_requests%rowtype;
  v_existing public.time_correction_events%rowtype;
  v_source jsonb;
  v_source_kind public.time_correction_source_kind;
  v_source_id uuid;
  v_source_version text;
  v_actual_version text;
  v_actual_employee_id uuid;
  v_revision bigint;
  v_ordinal integer := 0;
  v_application_source_count integer := 0;
begin
  if p_actor_id is null or p_operation_id is null
    or nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) not between 3 and 2000
    or p_source_scope_key !~ '^[0-9a-f]{64}$'
    or p_source_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_before_snapshot -> 'facts') <> 'array'
    or jsonb_typeof(p_proposed_snapshot -> 'facts') <> 'array'
    or jsonb_typeof(p_sources) <> 'array'
  then raise exception 'time_correction_invalid_input'; end if;

  select * into v_existing from public.time_correction_events
  where operation_id = p_operation_id;
  if found then
    if v_existing.request_id <> p_request_id then
      raise exception 'time_correction_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'requestId', p_request_id, 'revision', v_existing.revision,
      'status', 'submitted', 'replayed', true
    );
  end if;

  select * into v_request from public.time_correction_requests
  where id = p_request_id for update;
  if not found then raise exception 'time_correction_not_found'; end if;
  if v_request.requested_by <> p_actor_id then
    raise exception 'time_correction_not_requester';
  end if;
  if v_request.status <> 'clarification_required' then
    raise exception 'time_correction_not_clarifiable';
  end if;
  if v_request.current_revision <> p_expected_revision then
    raise exception 'time_correction_stale_revision';
  end if;
  if v_request.kind in ('add', 'missed_clock')
    and jsonb_array_length(p_sources) <> 0
  then raise exception 'time_correction_sources_invalid'; end if;
  if v_request.kind not in ('add', 'missed_clock')
    and jsonb_array_length(p_sources) = 0
  then raise exception 'time_correction_sources_required'; end if;

  v_revision := p_expected_revision + 1;
  insert into public.time_correction_request_revisions (
    request_id, organization_id, revision, reason, source_fingerprint,
    before_snapshot, proposed_snapshot, created_by
  ) values (
    p_request_id, v_request.organization_id, v_revision, btrim(p_reason),
    p_source_fingerprint, p_before_snapshot, p_proposed_snapshot, p_actor_id
  );

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    begin
      v_source_kind := (v_source ->> 'kind')::public.time_correction_source_kind;
      v_source_id := (v_source ->> 'id')::uuid;
      v_source_version := v_source ->> 'version';
    exception when others then
      raise exception 'time_correction_source_invalid';
    end;
    if v_source_kind = 'legacy_entry' then
      select entry.updated_at::text, employee.id
        into v_actual_version, v_actual_employee_id
      from public.time_entries entry
      join public.employee_records employee
        on employee.organization_id = entry.organization_id
       and employee.user_id = entry.user_id
      where entry.id = v_source_id
        and entry.organization_id = v_request.organization_id;
    elsif v_source_kind = 'canonical_session' then
      select version::text, employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_sessions
      where id = v_source_id and organization_id = v_request.organization_id;
    elsif v_source_kind = 'canonical_segment' then
      select updated_at::text, employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_segments
      where id = v_source_id and organization_id = v_request.organization_id;
    else
      v_application_source_count := v_application_source_count + 1;
      select application.source_fingerprint, request.subject_employee_record_id
        into v_actual_version, v_actual_employee_id
      from public.time_correction_applications application
      join public.time_correction_requests request on request.id = application.request_id
      where application.id = v_source_id
        and application.organization_id = v_request.organization_id;
    end if;
    if v_application_source_count > 1 or v_actual_version is null
      or v_actual_employee_id <> v_request.subject_employee_record_id
      or v_actual_version <> v_source_version
    then raise exception 'time_correction_source_stale_or_wrong_subject'; end if;
    insert into public.time_correction_request_sources (
      request_id, organization_id, revision, ordinal, source_kind,
      time_entry_id, time_session_id, time_segment_id,
      correction_application_id, source_version
    ) values (
      p_request_id, v_request.organization_id, v_revision, v_ordinal,
      v_source_kind,
      case when v_source_kind = 'legacy_entry' then v_source_id end,
      case when v_source_kind = 'canonical_session' then v_source_id end,
      case when v_source_kind = 'canonical_segment' then v_source_id end,
      case when v_source_kind = 'correction_application' then v_source_id end,
      v_source_version
    );
    v_ordinal := v_ordinal + 1;
  end loop;

  update public.time_correction_requests set
    current_revision = v_revision, source_scope_key = p_source_scope_key,
    status = 'submitted', reviewed_by = null, reviewed_at = null,
    decision_comment = null
  where id = p_request_id;
  insert into public.time_correction_events (
    organization_id, request_id, revision, event_type, actor_id, operation_id
  ) values (
    v_request.organization_id, p_request_id, v_revision,
    'resubmitted', p_actor_id, p_operation_id
  );
  return jsonb_build_object(
    'requestId', p_request_id, 'revision', v_revision,
    'status', 'submitted', 'replayed', false
  );
end;
$$;

create or replace function public.decide_time_correction(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_decision text,
  p_comment text,
  p_responsibility_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.time_correction_requests%rowtype;
  v_revision public.time_correction_request_revisions%rowtype;
  v_existing public.time_correction_events%rowtype;
  v_application_id uuid;
  v_previous_application_id uuid;
begin
  if p_actor_id is null or p_operation_id is null
    or p_decision not in ('approve', 'reject', 'clarify')
  then raise exception 'time_correction_invalid_input'; end if;

  select * into v_existing from public.time_correction_events
  where operation_id = p_operation_id;
  if found then
    if v_existing.request_id <> p_request_id then
      raise exception 'time_correction_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'requestId', v_existing.request_id,
      'status', case v_existing.event_type
        when 'approved' then 'approved'
        when 'rejected' then 'rejected'
        else 'clarification_required' end,
      'replayed', true
    );
  end if;

  select * into v_request from public.time_correction_requests
  where id = p_request_id for update;
  if not found then raise exception 'time_correction_not_found'; end if;
  if v_request.status <> 'submitted' then
    raise exception 'time_correction_not_submitted';
  end if;
  if v_request.current_revision <> p_expected_revision then
    raise exception 'time_correction_stale_revision';
  end if;
  if not app_private.is_time_approval_holder(
    v_request.organization_id, p_actor_id, v_request.subject_user_id
  ) then
    if p_actor_id = v_request.subject_user_id then
      raise exception 'time_correction_self_approval_forbidden';
    end if;
    raise exception 'time_correction_not_responsible';
  end if;
  if p_decision in ('reject', 'clarify')
    and nullif(btrim(p_comment), '') is null
  then raise exception 'time_correction_comment_required'; end if;

  select * into v_revision from public.time_correction_request_revisions
  where request_id = p_request_id and revision = p_expected_revision;
  if not found then raise exception 'time_correction_revision_missing'; end if;

  if p_decision = 'approve' then
    perform app_private.assert_time_correction_sources_current(
      p_request_id, p_expected_revision
    );
    select correction_application_id into v_previous_application_id
    from public.time_correction_request_sources
    where request_id = p_request_id and revision = p_expected_revision
      and source_kind = 'correction_application'
    order by ordinal
    limit 1;
    insert into public.time_correction_applications (
      organization_id, request_id, revision, applied_by, operation_id,
      previous_application_id, source_fingerprint, before_snapshot, applied_snapshot,
      responsibility_snapshot
    ) values (
      v_request.organization_id, p_request_id, p_expected_revision,
      p_actor_id, p_operation_id, v_previous_application_id,
      v_revision.source_fingerprint,
      v_revision.before_snapshot, v_revision.proposed_snapshot,
      coalesce(p_responsibility_snapshot, '{}'::jsonb)
    ) returning id into v_application_id;

    update public.time_correction_requests set
      status = 'approved', reviewed_by = p_actor_id,
      reviewed_at = clock_timestamp(), decision_comment = null
    where id = p_request_id;
    insert into public.time_correction_events (
      organization_id, request_id, revision, event_type, actor_id,
      operation_id, comment, responsibility_snapshot
    ) values (
      v_request.organization_id, p_request_id, p_expected_revision,
      'approved', p_actor_id, p_operation_id, null,
      coalesce(p_responsibility_snapshot, '{}'::jsonb)
    );
    return jsonb_build_object(
      'requestId', p_request_id, 'applicationId', v_application_id,
      'status', 'approved', 'replayed', false
    );
  end if;

  update public.time_correction_requests set
    status = case when p_decision = 'reject'
      then 'rejected'::public.time_correction_status
      else 'clarification_required'::public.time_correction_status end,
    reviewed_by = case when p_decision = 'reject' then p_actor_id else null end,
    reviewed_at = case when p_decision = 'reject' then clock_timestamp() else null end,
    decision_comment = btrim(p_comment)
  where id = p_request_id;
  insert into public.time_correction_events (
    organization_id, request_id, revision, event_type, actor_id,
    operation_id, comment, responsibility_snapshot
  ) values (
    v_request.organization_id, p_request_id, p_expected_revision,
    case when p_decision = 'reject'
      then 'rejected'::public.time_correction_event_type
      else 'clarification_requested'::public.time_correction_event_type end,
    p_actor_id, p_operation_id, btrim(p_comment),
    coalesce(p_responsibility_snapshot, '{}'::jsonb)
  );
  return jsonb_build_object(
    'requestId', p_request_id,
    'status', case when p_decision = 'reject'
      then 'rejected' else 'clarification_required' end,
    'replayed', false
  );
end;
$$;

create or replace function public.withdraw_time_correction(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_request public.time_correction_requests%rowtype;
begin
  if exists (select 1 from public.time_correction_events where operation_id = p_operation_id) then
    return jsonb_build_object('requestId', p_request_id, 'status', 'withdrawn', 'replayed', true);
  end if;
  select * into v_request from public.time_correction_requests
  where id = p_request_id for update;
  if not found then raise exception 'time_correction_not_found'; end if;
  if v_request.requested_by <> p_actor_id then
    raise exception 'time_correction_not_requester';
  end if;
  if v_request.status not in ('submitted', 'clarification_required') then
    raise exception 'time_correction_not_withdrawable';
  end if;
  update public.time_correction_requests set
    status = 'withdrawn', reviewed_by = null, reviewed_at = null
  where id = p_request_id;
  insert into public.time_correction_events (
    organization_id, request_id, revision, event_type, actor_id, operation_id
  ) values (
    v_request.organization_id, p_request_id, v_request.current_revision,
    'withdrawn', p_actor_id, p_operation_id
  );
  return jsonb_build_object('requestId', p_request_id, 'status', 'withdrawn', 'replayed', false);
end;
$$;

create or replace function public.decide_time_correction_batch(
  p_request_ids uuid[],
  p_actor_id uuid,
  p_operation_ids uuid[],
  p_expected_revisions bigint[],
  p_decision text,
  p_comment text,
  p_responsibility_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_index integer;
  v_results jsonb := '[]'::jsonb;
begin
  if coalesce(array_length(p_request_ids, 1), 0) = 0
    or array_length(p_request_ids, 1) <> array_length(p_operation_ids, 1)
    or array_length(p_request_ids, 1) <> array_length(p_expected_revisions, 1)
  then raise exception 'time_correction_batch_invalid'; end if;
  for v_index in 1..array_length(p_request_ids, 1) loop
    v_results := v_results || jsonb_build_array(public.decide_time_correction(
      p_request_ids[v_index], p_actor_id, p_operation_ids[v_index],
      p_expected_revisions[v_index], p_decision, p_comment,
      p_responsibility_snapshot
    ));
  end loop;
  return jsonb_build_object('results', v_results);
end;
$$;

alter table public.time_correction_requests enable row level security;
alter table public.time_correction_request_revisions enable row level security;
alter table public.time_correction_request_sources enable row level security;
alter table public.time_correction_events enable row level security;
alter table public.time_correction_applications enable row level security;

create policy time_correction_requests_select_permitted
on public.time_correction_requests for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and (
    requested_by = (select auth.uid())
    or subject_user_id = (select auth.uid())
    or organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or app_private.is_time_approval_holder(
      organization_id, (select auth.uid()), subject_user_id
    )
  )
);

create policy time_correction_revisions_select_permitted
on public.time_correction_request_revisions for select to authenticated
using (exists (
  select 1 from public.time_correction_requests request
  where request.id = time_correction_request_revisions.request_id
    and request.organization_id = time_correction_request_revisions.organization_id
));
create policy time_correction_sources_select_permitted
on public.time_correction_request_sources for select to authenticated
using (exists (
  select 1 from public.time_correction_requests request
  where request.id = time_correction_request_sources.request_id
    and request.organization_id = time_correction_request_sources.organization_id
));
create policy time_correction_events_select_permitted
on public.time_correction_events for select to authenticated
using (exists (
  select 1 from public.time_correction_requests request
  where request.id = time_correction_events.request_id
    and request.organization_id = time_correction_events.organization_id
));
create policy time_correction_applications_select_permitted
on public.time_correction_applications for select to authenticated
using (exists (
  select 1 from public.time_correction_requests request
  where request.id = time_correction_applications.request_id
    and request.organization_id = time_correction_applications.organization_id
));

revoke all on public.time_correction_requests from anon, authenticated;
revoke all on public.time_correction_request_revisions from anon, authenticated;
revoke all on public.time_correction_request_sources from anon, authenticated;
revoke all on public.time_correction_events from anon, authenticated;
revoke all on public.time_correction_applications from anon, authenticated;
grant select on public.time_correction_requests to authenticated;
grant select on public.time_correction_request_revisions to authenticated;
grant select on public.time_correction_request_sources to authenticated;
grant select on public.time_correction_events to authenticated;
grant select on public.time_correction_applications to authenticated;

revoke all on function app_private.guard_time_correction_immutable() from public, anon, authenticated;
revoke all on function app_private.is_time_approval_holder(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.assert_time_correction_sources_current(uuid, bigint) from public, anon, authenticated;
revoke all on function public.create_time_correction_request(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.revise_time_correction_request(uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.decide_time_correction(uuid, uuid, uuid, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.withdraw_time_correction(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_time_correction_batch(uuid[], uuid, uuid[], bigint[], text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_time_correction_request(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.revise_time_correction_request(uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.decide_time_correction(uuid, uuid, uuid, bigint, text, text, jsonb) to service_role;
grant execute on function public.withdraw_time_correction(uuid, uuid, uuid) to service_role;
grant execute on function public.decide_time_correction_batch(uuid[], uuid, uuid[], bigint[], text, text, jsonb) to service_role;
grant execute on function app_private.is_time_approval_holder(uuid, uuid, uuid) to authenticated;

alter table public.time_correction_requests replica identity using index time_correction_requests_replident_idx;
alter publication supabase_realtime add table public.time_correction_requests;

alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review'
    ])
  );
alter table public.attention_events
  drop constraint attention_events_source_type_check;
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review'
    ])
  );
