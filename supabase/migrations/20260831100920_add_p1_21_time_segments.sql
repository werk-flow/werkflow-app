-- P1-21: stable attendance sessions and explicit factual activity segments.
-- Legacy time_entries remain unchanged compatibility facts. This migration
-- does not backfill or infer historical sessions.

create type public.time_session_status as enum (
  'open', 'closed', 'recovery_required'
);

create type public.time_segment_kind as enum (
  'work', 'travel', 'break', 'standby', 'callout', 'internal_activity'
);

create type public.time_allocation_kind as enum (
  'job', 'internal_activity', 'unallocated', 'none'
);

create type public.time_capture_source as enum (
  'employee', 'manager', 'system_recovery', 'legacy_compatibility'
);

create type public.time_travel_route as enum (
  'company_to_site', 'home_to_site', 'site_to_site',
  'site_to_company', 'other', 'unspecified'
);

create type public.time_travel_role as enum (
  'driver', 'passenger', 'unspecified'
);

create type public.time_standby_context as enum (
  'on_site', 'remote', 'unspecified'
);

create type public.time_operation_kind as enum (
  'start', 'switch', 'end', 'continue_legacy', 'end_legacy',
  'recover_continue', 'recover_end', 'system_repair'
);

create type public.time_segment_event_type as enum (
  'session_started', 'segment_started', 'segment_ended', 'session_ended',
  'recovery_required', 'recovery_acknowledged', 'legacy_closed', 'system_repair'
);

create table public.time_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  -- Kept as the capture identity even if a login is removed later.
  user_id uuid not null,
  status public.time_session_status not null default 'open',
  started_at timestamptz not null,
  ended_at timestamptz,
  version bigint not null default 1 check (version > 0),
  recovery_reason text,
  created_by uuid references auth.users(id) on delete set null,
  ended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_sessions_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_sessions_end_after_start_check
    check (ended_at is null or ended_at >= started_at),
  constraint time_sessions_status_shape_check check (
    (status in ('open', 'recovery_required') and ended_at is null)
    or (status = 'closed' and ended_at is not null)
  ),
  constraint time_sessions_recovery_reason_check check (
    (status = 'recovery_required' and nullif(btrim(recovery_reason), '') is not null)
    or (status <> 'recovery_required' and recovery_reason is null)
  )
);

create unique index time_sessions_replident_idx
  on public.time_sessions(id, organization_id);
create unique index time_sessions_open_employee_unique
  on public.time_sessions(employee_record_id)
  where ended_at is null;
create unique index time_sessions_open_user_unique
  on public.time_sessions(user_id)
  where ended_at is null;
create index time_sessions_org_employee_started_idx
  on public.time_sessions(organization_id, employee_record_id, started_at desc, id desc);
create index time_sessions_org_status_idx
  on public.time_sessions(organization_id, status, started_at desc);

create table public.time_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  employee_record_id uuid not null,
  kind public.time_segment_kind not null,
  allocation_kind public.time_allocation_kind not null,
  job_id uuid,
  internal_type public.planning_internal_type,
  travel_route public.time_travel_route,
  travel_role public.time_travel_role,
  standby_context public.time_standby_context,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_source public.time_capture_source not null,
  end_source public.time_capture_source,
  started_by uuid references auth.users(id) on delete set null,
  ended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_segments_session_org_fkey
    foreign key (session_id, organization_id)
    references public.time_sessions(id, organization_id) on delete restrict,
  constraint time_segments_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_segments_job_org_fkey
    foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete restrict,
  constraint time_segments_end_after_start_check
    check (ended_at is null or ended_at >= started_at),
  constraint time_segments_end_attribution_check check (
    (ended_at is null and end_source is null and ended_by is null)
    or (ended_at is not null and end_source is not null)
  ),
  constraint time_segments_allocation_shape_check check (
    (
      kind in ('work', 'travel', 'callout')
      and allocation_kind in ('job', 'unallocated')
      and ((allocation_kind = 'job' and job_id is not null)
        or (allocation_kind = 'unallocated' and job_id is null))
      and internal_type is null
    )
    or (
      kind = 'internal_activity'
      and allocation_kind = 'internal_activity'
      and job_id is null
      and internal_type is not null
    )
    or (
      kind in ('break', 'standby')
      and allocation_kind = 'none'
      and job_id is null
      and internal_type is null
    )
  ),
  constraint time_segments_travel_shape_check check (
    (kind = 'travel' and travel_route is not null and travel_role is not null)
    or (kind <> 'travel' and travel_route is null and travel_role is null)
  ),
  constraint time_segments_standby_shape_check check (
    (kind = 'standby' and standby_context is not null)
    or (kind <> 'standby' and standby_context is null)
  )
);

create unique index time_segments_id_org_unique
  on public.time_segments(id, organization_id);
create unique index time_segments_open_session_unique
  on public.time_segments(session_id)
  where ended_at is null;
create index time_segments_session_started_idx
  on public.time_segments(session_id, started_at, id);
create index time_segments_org_employee_started_idx
  on public.time_segments(organization_id, employee_record_id, started_at desc, id desc);
create index time_segments_org_job_started_idx
  on public.time_segments(organization_id, job_id, started_at desc, id desc)
  where job_id is not null;
create index time_segments_org_unallocated_idx
  on public.time_segments(organization_id, started_at desc, id desc)
  where allocation_kind = 'unallocated';

create table public.time_operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null,
  actor_id uuid,
  operation_kind public.time_operation_kind not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  expected_session_id uuid,
  expected_version bigint,
  resulting_session_id uuid,
  resulting_segment_id uuid,
  resulting_version bigint,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint time_operations_employee_org_fkey
    foreign key (employee_record_id, organization_id)
    references public.employee_records(id, organization_id) on delete restrict,
  constraint time_operations_result_session_fkey
    foreign key (resulting_session_id, organization_id)
    references public.time_sessions(id, organization_id)
    deferrable initially deferred,
  constraint time_operations_result_segment_fkey
    foreign key (resulting_segment_id, organization_id)
    references public.time_segments(id, organization_id)
    deferrable initially deferred
);

create index time_operations_org_employee_created_idx
  on public.time_operations(organization_id, employee_record_id, created_at desc, id desc);
create index time_operations_result_session_idx
  on public.time_operations(resulting_session_id)
  where resulting_session_id is not null;
create index time_operations_result_segment_idx
  on public.time_operations(resulting_segment_id)
  where resulting_segment_id is not null;

create table public.time_segment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid,
  segment_id uuid,
  operation_id uuid not null,
  event_type public.time_segment_event_type not null,
  source public.time_capture_source not null,
  actor_id uuid,
  occurred_at timestamptz not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint time_segment_events_session_fkey
    foreign key (session_id, organization_id)
    references public.time_sessions(id, organization_id)
    deferrable initially deferred,
  constraint time_segment_events_segment_fkey
    foreign key (segment_id, organization_id)
    references public.time_segments(id, organization_id)
    deferrable initially deferred,
  constraint time_segment_events_operation_fkey
    foreign key (operation_id)
    references public.time_operations(id)
    deferrable initially deferred
);

create index time_segment_events_session_occurred_idx
  on public.time_segment_events(session_id, occurred_at, id);
create index time_segment_events_segment_occurred_idx
  on public.time_segment_events(segment_id, occurred_at, id)
  where segment_id is not null;
create index time_segment_events_operation_idx
  on public.time_segment_events(operation_id);
create index time_segment_events_org_occurred_idx
  on public.time_segment_events(organization_id, occurred_at desc, id desc);

alter table public.time_entries
  add column capture_source public.time_capture_source,
  add column operation_id uuid,
  add column recovery_reason text;

alter table public.time_entries
  add constraint time_entries_operation_fkey
  foreign key (operation_id) references public.time_operations(id)
  deferrable initially deferred;

create index time_entries_operation_idx
  on public.time_entries(operation_id)
  where operation_id is not null;

comment on column public.time_entries.capture_source is
  'P1-21 provenance for newly appended compatibility or recovery events. Null preserves legacy source meaning.';

create or replace function app_private.guard_time_capture_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if current_setting('app.time_capture_write', true) is distinct from 'true' then
    raise exception 'time_capture_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_time_sessions_write
before insert or update or delete on public.time_sessions
for each row execute function app_private.guard_time_capture_write();
create trigger guard_time_segments_write
before insert or update or delete on public.time_segments
for each row execute function app_private.guard_time_capture_write();
create trigger guard_time_operations_write
before insert or update or delete on public.time_operations
for each row execute function app_private.guard_time_capture_write();
create trigger guard_time_segment_events_write
before insert or update or delete on public.time_segment_events
for each row execute function app_private.guard_time_capture_write();

create or replace function app_private.guard_time_capture_append_only()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  raise exception 'time_capture_append_only';
end;
$$;

create trigger guard_time_operations_append_only
before update or delete on public.time_operations
for each row execute function app_private.guard_time_capture_append_only();
create trigger guard_time_segment_events_append_only
before update or delete on public.time_segment_events
for each row execute function app_private.guard_time_capture_append_only();

alter table public.time_sessions enable row level security;
alter table public.time_segments enable row level security;
alter table public.time_operations enable row level security;
alter table public.time_segment_events enable row level security;

create policy time_sessions_select_permitted
on public.time_sessions for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  )
);

create policy time_segments_select_permitted
on public.time_segments for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and exists (
    select 1 from public.time_sessions session
    where session.id = time_segments.session_id
      and session.organization_id = time_segments.organization_id
      and (
        session.user_id = (select auth.uid())
        or session.organization_id in (
          select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
        )
      )
  )
);

create policy time_operations_select_permitted
on public.time_operations for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and (
    actor_id = (select auth.uid())
    or organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  )
);

create policy time_segment_events_select_permitted
on public.time_segment_events for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and exists (
    select 1 from public.time_sessions session
    where session.id = time_segment_events.session_id
      and session.organization_id = time_segment_events.organization_id
      and (
        session.user_id = (select auth.uid())
        or session.organization_id in (
          select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
        )
      )
  )
);

revoke all on public.time_sessions, public.time_segments,
  public.time_operations, public.time_segment_events from anon, authenticated;
grant select on public.time_sessions, public.time_segments,
  public.time_operations, public.time_segment_events to authenticated;

create or replace function app_private.validate_time_segment_input(
  p_organization_id uuid,
  p_actor_id uuid,
  p_role public.org_role,
  p_kind public.time_segment_kind,
  p_allocation_kind public.time_allocation_kind,
  p_job_id uuid,
  p_internal_type public.planning_internal_type,
  p_travel_route public.time_travel_route,
  p_travel_role public.time_travel_role,
  p_standby_context public.time_standby_context
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_break_mode public.time_tracking_break_mode;
begin
  if p_kind in ('work', 'travel', 'callout') then
    if p_allocation_kind not in ('job', 'unallocated')
      or (p_allocation_kind = 'job') <> (p_job_id is not null)
      or p_internal_type is not null
    then raise exception 'time_transition_allocation_invalid'; end if;
  elsif p_kind = 'internal_activity' then
    if p_allocation_kind <> 'internal_activity' or p_job_id is not null
      or p_internal_type is null
    then raise exception 'time_transition_allocation_invalid'; end if;
  elsif p_kind in ('break', 'standby') then
    if p_allocation_kind <> 'none' or p_job_id is not null or p_internal_type is not null
    then raise exception 'time_transition_allocation_invalid'; end if;
  end if;

  if (p_kind = 'travel') <> (p_travel_route is not null and p_travel_role is not null)
    or (p_kind <> 'travel' and (p_travel_route is not null or p_travel_role is not null))
  then raise exception 'time_transition_travel_invalid'; end if;

  if (p_kind = 'standby') <> (p_standby_context is not null)
    or (p_kind <> 'standby' and p_standby_context is not null)
  then raise exception 'time_transition_standby_invalid'; end if;

  if p_kind = 'break' then
    select settings.break_mode into v_break_mode
    from public.organization_settings settings
    where settings.organization_id = p_organization_id;
    if coalesce(v_break_mode, 'manual'::public.time_tracking_break_mode) <> 'manual'
    then raise exception 'time_transition_break_mode_automatic'; end if;
  end if;

  if p_job_id is not null then
    if not exists (
      select 1 from public.jobs job
      where job.id = p_job_id
        and job.organization_id = p_organization_id
        and job.status <> 'fertig'
    ) then raise exception 'time_transition_job_unavailable'; end if;

    if p_role = 'employee' and not exists (
      select 1 from public.job_assignments assignment
      where assignment.organization_id = p_organization_id
        and assignment.job_id = p_job_id
        and assignment.user_id = p_actor_id
    ) then raise exception 'time_transition_job_not_assigned'; end if;
  end if;
end;
$$;

create or replace function public.transition_time_activity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_action public.time_operation_kind,
  p_expected_session_id uuid default null,
  p_expected_version bigint default null,
  p_segment_kind public.time_segment_kind default null,
  p_allocation_kind public.time_allocation_kind default null,
  p_job_id uuid default null,
  p_internal_type public.planning_internal_type default null,
  p_travel_route public.time_travel_route default null,
  p_travel_role public.time_travel_role default null,
  p_standby_context public.time_standby_context default null,
  p_acknowledge_long boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_role public.org_role;
  v_employee public.employee_records%rowtype;
  v_session public.time_sessions%rowtype;
  v_segment public.time_segments%rowtype;
  v_legacy_last public.time_entries%rowtype;
  v_existing public.time_operations%rowtype;
  v_legacy_open boolean := false;
  v_recovery_transitioned boolean := false;
  v_new_session_id uuid;
  v_new_segment_id uuid;
  v_result jsonb;
  v_source public.time_capture_source := 'employee'::public.time_capture_source;
  v_job public.jobs%rowtype;
  v_job_state public.work_execution_state;
begin
  if p_actor_id is null or p_operation_id is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'time_transition_invalid_input'; end if;

  select membership.role into v_role
  from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_id;
  if v_role is null then raise exception 'time_transition_not_authorized'; end if;

  select * into v_employee
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id = p_actor_id
  for update;
  if not found then raise exception 'time_transition_employee_missing'; end if;

  select * into v_existing
  from public.time_operations operation
  where operation.id = p_operation_id;
  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.employee_record_id <> v_employee.id
      or v_existing.request_hash <> p_request_hash
    then raise exception 'time_transition_idempotency_conflict'; end if;
    return v_existing.result_payload || jsonb_build_object('replayed', true);
  end if;

  if exists (
    select 1 from public.time_sessions session
    where session.user_id = p_actor_id
      and session.ended_at is null
      and session.organization_id <> p_organization_id
  ) then raise exception 'time_transition_working_other_org'; end if;

  if exists (
    select 1
    from (
      select distinct on (entry.organization_id)
        entry.organization_id, entry.entry_type
      from public.time_entries entry
      where entry.user_id = p_actor_id
        and entry.status not in ('rejected', 'pending_delete')
      order by entry.organization_id, entry.timestamp desc, entry.created_at desc, entry.id desc
    ) latest
    where latest.organization_id <> p_organization_id
      and latest.entry_type <> 'clock_out'
  ) then raise exception 'time_transition_working_other_org'; end if;

  select * into v_session
  from public.time_sessions session
  where session.user_id = p_actor_id and session.ended_at is null
  for update;

  select * into v_legacy_last
  from public.time_entries entry
  where entry.user_id = p_actor_id
    and entry.organization_id = p_organization_id
    and entry.status not in ('rejected', 'pending_delete')
  order by entry.timestamp desc, entry.created_at desc, entry.id desc
  limit 1;
  v_legacy_open := found and v_legacy_last.entry_type <> 'clock_out';

  if v_session.id is not null then
    select * into v_segment
    from public.time_segments segment
    where segment.session_id = v_session.id and segment.ended_at is null
    for update;
  end if;

  if v_session.id is not null and v_legacy_open then
    perform set_config('app.time_capture_write', 'true', true);
    update public.time_sessions
    set status = 'recovery_required', recovery_reason = 'canonical_and_legacy_open',
        version = version + 1, updated_at = v_now
    where id = v_session.id
    returning * into v_session;
    v_recovery_transitioned := true;
  end if;

  if v_session.id is not null
    and v_session.status = 'open'
    and v_segment.id is null
  then
    perform set_config('app.time_capture_write', 'true', true);
    update public.time_sessions
    set status = 'recovery_required', recovery_reason = 'open_segment_missing',
        version = version + 1, updated_at = v_now
    where id = v_session.id
    returning * into v_session;
    v_recovery_transitioned := true;
  end if;

  if v_session.id is not null
    and v_session.status = 'open'
    and v_now - v_session.started_at > interval '24 hours'
    and p_action not in ('end', 'recover_end')
    and not p_acknowledge_long
  then
    perform set_config('app.time_capture_write', 'true', true);
    update public.time_sessions
    set status = 'recovery_required', recovery_reason = 'unusually_long',
        version = version + 1, updated_at = v_now
    where id = v_session.id
    returning * into v_session;
    v_recovery_transitioned := true;
  end if;

  if v_session.id is not null and v_session.status = 'recovery_required'
    and p_action not in ('recover_continue', 'recover_end')
  then
    v_result := jsonb_build_object(
      'outcome', 'recovery_required',
      'sessionId', v_session.id,
      'segmentId', v_segment.id,
      'version', v_session.version,
      'recoveryReason', v_session.recovery_reason,
      'replayed', false
    );
    perform set_config('app.time_capture_write', 'true', true);
    insert into public.time_operations (
      id, organization_id, employee_record_id, actor_id, operation_kind,
      request_hash, expected_session_id, expected_version,
      resulting_session_id, resulting_segment_id, resulting_version, result_payload
    ) values (
      p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
      p_request_hash, p_expected_session_id, p_expected_version,
      v_session.id, v_segment.id, v_session.version, v_result
    );
    insert into public.time_segment_events (
      organization_id, session_id, segment_id, operation_id, event_type,
      source, actor_id, occurred_at, event_payload
    ) values (
      p_organization_id, v_session.id, v_segment.id, p_operation_id,
      'recovery_required', 'system_recovery', null, v_now,
      jsonb_build_object('reason', v_session.recovery_reason)
    );
    perform set_config('app.time_capture_write', 'false', true);
    return v_result;
  end if;

  if v_session.id is not null and p_expected_session_id is distinct from v_session.id
  then raise exception 'time_transition_stale_version'; end if;
  if v_session.id is not null
    and p_expected_version is distinct from (
      case
        when v_recovery_transitioned
          and p_action in ('recover_continue', 'recover_end')
        then v_session.version - 1
        else v_session.version
      end
    )
  then raise exception 'time_transition_stale_version'; end if;

  if p_action in ('start', 'continue_legacy', 'recover_continue', 'switch') then
    if p_segment_kind is null or p_allocation_kind is null
    then raise exception 'time_transition_segment_required'; end if;
    perform app_private.validate_time_segment_input(
      p_organization_id, p_actor_id, v_role, p_segment_kind,
      p_allocation_kind, p_job_id, p_internal_type,
      p_travel_route, p_travel_role, p_standby_context
    );
  end if;

  perform set_config('app.time_capture_write', 'true', true);

  if p_action = 'start' then
    if v_session.id is not null then raise exception 'time_transition_already_open'; end if;
    if v_legacy_open then raise exception 'time_transition_legacy_open'; end if;
    if p_expected_session_id is not null or p_expected_version is not null
    then raise exception 'time_transition_stale_version'; end if;

    v_new_session_id := gen_random_uuid();
    v_new_segment_id := gen_random_uuid();
    insert into public.time_sessions (
      id, organization_id, employee_record_id, user_id, status,
      started_at, version, created_by
    ) values (
      v_new_session_id, p_organization_id, v_employee.id, p_actor_id,
      'open', v_now, 1, p_actor_id
    ) returning * into v_session;

  elsif p_action = 'continue_legacy' then
    if v_session.id is not null or not v_legacy_open
    then raise exception 'time_transition_legacy_state_changed'; end if;
    insert into public.time_entries (
      user_id, organization_id, entry_type, timestamp, is_manual, status,
      job_id, capture_source, operation_id
    ) values (
      p_actor_id, p_organization_id, 'clock_out', v_now, false, 'approved',
      null, 'legacy_compatibility', p_operation_id
    );
    v_source := 'legacy_compatibility';
    v_new_session_id := gen_random_uuid();
    v_new_segment_id := gen_random_uuid();
    insert into public.time_sessions (
      id, organization_id, employee_record_id, user_id, status,
      started_at, version, created_by
    ) values (
      v_new_session_id, p_organization_id, v_employee.id, p_actor_id,
      'open', v_now, 1, p_actor_id
    ) returning * into v_session;

  elsif p_action = 'end_legacy' then
    if v_session.id is not null or not v_legacy_open
    then raise exception 'time_transition_legacy_state_changed'; end if;
    insert into public.time_entries (
      user_id, organization_id, entry_type, timestamp, is_manual, status,
      job_id, capture_source, operation_id
    ) values (
      p_actor_id, p_organization_id, 'clock_out', v_now, false, 'approved',
      null, 'legacy_compatibility', p_operation_id
    );
    v_result := jsonb_build_object(
      'outcome', 'ended', 'sessionId', null, 'segmentId', null,
      'version', null, 'legacyBridged', true, 'replayed', false
    );
    insert into public.time_operations (
      id, organization_id, employee_record_id, actor_id, operation_kind,
      request_hash, expected_session_id, expected_version, result_payload
    ) values (
      p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
      p_request_hash, null, null, v_result
    );
    insert into public.time_segment_events (
      organization_id, operation_id, event_type, source, actor_id,
      occurred_at, event_payload
    ) values (
      p_organization_id, p_operation_id, 'legacy_closed',
      'legacy_compatibility', p_actor_id, v_now,
      jsonb_build_object('legacyEntryId', v_legacy_last.id)
    );
    perform set_config('app.time_capture_write', 'false', true);
    return v_result;

  elsif p_action in ('switch', 'recover_continue') then
    if v_session.id is null then raise exception 'time_transition_not_open'; end if;
    if p_action = 'recover_continue' then
      if v_session.status <> 'recovery_required' or not p_acknowledge_long
      then raise exception 'time_transition_recovery_ack_required'; end if;
      update public.time_sessions
      set status = 'open', recovery_reason = null, version = version + 1,
          updated_at = v_now
      where id = v_session.id returning * into v_session;
      insert into public.time_segment_events (
        organization_id, session_id, segment_id, operation_id, event_type,
        source, actor_id, occurred_at
      ) values (
        p_organization_id, v_session.id, v_segment.id, p_operation_id,
        'recovery_acknowledged', 'employee', p_actor_id, v_now
      );
    end if;

    if v_segment.id is not null
      and v_segment.kind = p_segment_kind
      and v_segment.allocation_kind = p_allocation_kind
      and v_segment.job_id is not distinct from p_job_id
      and v_segment.internal_type is not distinct from p_internal_type
      and v_segment.travel_route is not distinct from p_travel_route
      and v_segment.travel_role is not distinct from p_travel_role
      and v_segment.standby_context is not distinct from p_standby_context
    then
      v_result := jsonb_build_object(
        'outcome', 'no_change', 'sessionId', v_session.id,
        'segmentId', v_segment.id, 'version', v_session.version,
        'replayed', false
      );
      insert into public.time_operations (
        id, organization_id, employee_record_id, actor_id, operation_kind,
        request_hash, expected_session_id, expected_version,
        resulting_session_id, resulting_segment_id, resulting_version, result_payload
      ) values (
        p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
        p_request_hash, p_expected_session_id, p_expected_version,
        v_session.id, v_segment.id, v_session.version, v_result
      );
      perform set_config('app.time_capture_write', 'false', true);
      return v_result;
    end if;

    if v_segment.id is not null then
      update public.time_segments
      set ended_at = v_now, end_source = 'employee', ended_by = p_actor_id,
          updated_at = v_now
      where id = v_segment.id;
      insert into public.time_segment_events (
        organization_id, session_id, segment_id, operation_id, event_type,
        source, actor_id, occurred_at
      ) values (
        p_organization_id, v_session.id, v_segment.id, p_operation_id,
        'segment_ended', 'employee', p_actor_id, v_now
      );
    end if;
    v_new_segment_id := gen_random_uuid();
    update public.time_sessions
    set version = version + 1, updated_at = v_now
    where id = v_session.id returning * into v_session;

  elsif p_action in ('end', 'recover_end') then
    if v_session.id is null then raise exception 'time_transition_not_open'; end if;
    if p_action = 'recover_end' and v_session.status <> 'recovery_required'
    then raise exception 'time_transition_recovery_state_changed'; end if;
    if v_segment.id is not null then
      update public.time_segments
      set ended_at = v_now,
          end_source = case when p_action = 'recover_end'
            then 'system_recovery'::public.time_capture_source
            else 'employee'::public.time_capture_source end,
          ended_by = p_actor_id, updated_at = v_now
      where id = v_segment.id;
      insert into public.time_segment_events (
        organization_id, session_id, segment_id, operation_id, event_type,
        source, actor_id, occurred_at
      ) values (
        p_organization_id, v_session.id, v_segment.id, p_operation_id,
        'segment_ended',
        case when p_action = 'recover_end'
          then 'system_recovery'::public.time_capture_source
          else 'employee'::public.time_capture_source end,
        p_actor_id, v_now
      );
    end if;
    update public.time_sessions
    set status = 'closed', ended_at = v_now, ended_by = p_actor_id,
        recovery_reason = null, version = version + 1, updated_at = v_now
    where id = v_session.id returning * into v_session;
    insert into public.time_segment_events (
      organization_id, session_id, operation_id, event_type,
      source, actor_id, occurred_at
    ) values (
      p_organization_id, v_session.id, p_operation_id, 'session_ended',
      case when p_action = 'recover_end'
        then 'system_recovery'::public.time_capture_source
        else 'employee'::public.time_capture_source end,
      p_actor_id, v_now
    );
    v_result := jsonb_build_object(
      'outcome', 'ended', 'sessionId', v_session.id,
      'segmentId', v_segment.id, 'version', v_session.version,
      'legacyBridged', false, 'replayed', false
    );
    insert into public.time_operations (
      id, organization_id, employee_record_id, actor_id, operation_kind,
      request_hash, expected_session_id, expected_version,
      resulting_session_id, resulting_segment_id, resulting_version, result_payload
    ) values (
      p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
      p_request_hash, p_expected_session_id, p_expected_version,
      v_session.id, v_segment.id, v_session.version, v_result
    );
    perform set_config('app.time_capture_write', 'false', true);
    return v_result;
  else
    raise exception 'time_transition_action_invalid';
  end if;

  insert into public.time_segments (
    id, organization_id, session_id, employee_record_id, kind,
    allocation_kind, job_id, internal_type, travel_route, travel_role,
    standby_context, started_at, start_source, started_by
  ) values (
    v_new_segment_id, p_organization_id, v_session.id, v_employee.id,
    p_segment_kind, p_allocation_kind, p_job_id, p_internal_type,
    p_travel_route, p_travel_role, p_standby_context, v_now,
    v_source, p_actor_id
  ) returning * into v_segment;

  if p_action in ('start', 'continue_legacy') then
    insert into public.time_segment_events (
      organization_id, session_id, operation_id, event_type,
      source, actor_id, occurred_at
    ) values (
      p_organization_id, v_session.id, p_operation_id, 'session_started',
      v_source, p_actor_id, v_now
    );
  end if;
  insert into public.time_segment_events (
    organization_id, session_id, segment_id, operation_id, event_type,
    source, actor_id, occurred_at
  ) values (
    p_organization_id, v_session.id, v_segment.id, p_operation_id,
    'segment_started', v_source, p_actor_id, v_now
  );

  if p_job_id is not null and p_segment_kind in ('work', 'callout') then
    select * into v_job from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id;
    v_job_state := coalesce(
      v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status)
    );
    if v_job_state in ('not_started', 'interrupted') then
      perform public.transition_work_execution(
        p_organization_id, p_actor_id, 'job', p_job_id,
        v_job.execution_version, 'in_progress', null, false
      );
    elsif v_job_state in ('execution_complete', 'handed_over', 'cancelled') then
      raise exception 'time_transition_job_terminal';
    end if;
  end if;

  v_result := jsonb_build_object(
    'outcome', 'active', 'sessionId', v_session.id,
    'segmentId', v_segment.id, 'version', v_session.version,
    'legacyBridged', p_action = 'continue_legacy', 'replayed', false
  );
  insert into public.time_operations (
    id, organization_id, employee_record_id, actor_id, operation_kind,
    request_hash, expected_session_id, expected_version,
    resulting_session_id, resulting_segment_id, resulting_version, result_payload
  ) values (
    p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
    p_request_hash, p_expected_session_id, p_expected_version,
    v_session.id, v_segment.id, v_session.version, v_result
  );
  perform set_config('app.time_capture_write', 'false', true);
  return v_result;
end;
$$;

revoke all on function app_private.guard_time_capture_write() from public, anon, authenticated;
revoke all on function app_private.guard_time_capture_append_only() from public, anon, authenticated;
revoke all on function app_private.validate_time_segment_input(
  uuid, uuid, public.org_role, public.time_segment_kind,
  public.time_allocation_kind, uuid, public.planning_internal_type,
  public.time_travel_route, public.time_travel_role,
  public.time_standby_context
) from public, anon, authenticated;
revoke all on function public.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) from public, anon, authenticated;
grant execute on function public.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) to service_role;

-- P1-14/P1-17 compatibility: existing gate logic remains intact and gains
-- canonical open work/call-out segments without counting travel or standby.
alter function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
  rename to build_work_gate_snapshot_legacy_p1_21;

create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_snapshot jsonb;
  v_canonical_active integer := 0;
  v_canonical_total integer := 0;
  v_canonical_incomplete integer := 0;
  v_not_assessable jsonb;
begin
  v_snapshot := app_private.build_work_gate_snapshot_legacy_p1_21(
    p_organization_id, p_job_id, p_project_id
  );
  if p_job_id is not null then
    select
      count(*),
      count(*) filter (where segment.ended_at is null and session.ended_at is null),
      count(*) filter (where segment.ended_at is null or session.status = 'recovery_required')
    into v_canonical_total, v_canonical_active, v_canonical_incomplete
    from public.time_segments segment
    join public.time_sessions session
      on session.id = segment.session_id
      and session.organization_id = segment.organization_id
    where segment.organization_id = p_organization_id
      and segment.job_id = p_job_id
      and segment.kind in ('work', 'callout');
  elsif p_project_id is not null then
    select
      count(*),
      count(*) filter (where segment.ended_at is null and session.ended_at is null),
      count(*) filter (where segment.ended_at is null or session.status = 'recovery_required')
    into v_canonical_total, v_canonical_active, v_canonical_incomplete
    from public.time_segments segment
    join public.time_sessions session
      on session.id = segment.session_id
      and session.organization_id = segment.organization_id
    join public.jobs job
      on job.id = segment.job_id
      and job.organization_id = segment.organization_id
    where segment.organization_id = p_organization_id
      and job.project_id = p_project_id
      and segment.kind in ('work', 'callout');
  end if;
  v_snapshot := jsonb_set(
    v_snapshot,
    '{activeJobClocks}',
    to_jsonb(coalesce((v_snapshot->>'activeJobClocks')::integer, 0) + v_canonical_active)
  );
  v_not_assessable := coalesce(v_snapshot->'notAssessable', '[]'::jsonb);
  if v_canonical_total > 0 and v_canonical_incomplete = 0 then
    v_not_assessable := v_not_assessable - 'time_segment_completeness';
  end if;
  return jsonb_set(v_snapshot, '{notAssessable}', v_not_assessable);
end;
$$;

revoke all on function app_private.build_work_gate_snapshot_legacy_p1_21(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot_legacy_p1_21(
  uuid, uuid, uuid
) to service_role;
grant execute on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) to service_role;

alter table public.time_sessions
  replica identity using index time_sessions_replident_idx;
alter table public.time_segments
  replica identity using index time_segments_id_org_unique;
alter publication supabase_realtime add table public.time_sessions;
alter publication supabase_realtime add table public.time_segments;

-- P1-15 compatibility: artifact revisions may cite the stable canonical
-- segment identity without converting it back into a legacy event pair.
alter table public.work_artifact_revision_sources
  add column time_segment_id uuid;
alter table public.work_artifact_revision_sources
  drop constraint work_artifact_revision_sources_one_source_check,
  add constraint work_artifact_revision_sources_one_source_check check (
    (time_entry_id is not null)::integer
      + (time_segment_id is not null)::integer
      + (inventory_movement_id is not null)::integer = 1
  ),
  add constraint work_artifact_revision_sources_time_segment_fkey
    foreign key (time_segment_id, organization_id)
    references public.time_segments(id, organization_id) on delete restrict;
create unique index work_artifact_revision_sources_segment_idx
  on public.work_artifact_revision_sources(revision_id, time_segment_id)
  where time_segment_id is not null;
create index work_artifact_revision_sources_time_segment_lookup_idx
  on public.work_artifact_revision_sources(time_segment_id)
  where time_segment_id is not null;

create or replace function app_private.validate_work_artifact_relation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_revision_mismatch'; end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = v_revision.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_artifact_mismatch'; end if;

  if tg_table_name = 'work_artifact_revision_documents' then
    if not exists (
      select 1 from public.documents document
      join public.document_links link on link.document_id = document.id
      where document.id = new.document_id and document.organization_id = new.organization_id
        and document.deleted_at is null
        and ((v_artifact.job_id is not null and link.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and link.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_document_target_mismatch'; end if;
  elsif tg_table_name = 'work_artifact_revision_sources' then
    if new.time_entry_id is not null and not exists (
      select 1 from public.time_entries entry
      left join public.jobs job on job.id = entry.job_id
      where entry.id = new.time_entry_id and entry.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and entry.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and job.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_time_source_target_mismatch'; end if;
    if new.time_segment_id is not null and not exists (
      select 1 from public.time_segments segment
      left join public.jobs job on job.id = segment.job_id
      where segment.id = new.time_segment_id
        and segment.organization_id = new.organization_id
        and segment.job_id is not null
        and ((v_artifact.job_id is not null and segment.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and job.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_time_source_target_mismatch'; end if;
    if new.inventory_movement_id is not null and not exists (
      select 1 from public.inventory_movements movement
      left join public.jobs job on job.id = movement.job_id
      where movement.id = new.inventory_movement_id
        and movement.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and movement.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null
            and (movement.project_id = v_artifact.project_id or job.project_id = v_artifact.project_id)))
    ) then raise exception 'work_artifact_inventory_source_target_mismatch'; end if;
  else
    raise exception 'work_artifact_relation_table_invalid';
  end if;
  return new;
end;
$$;

create or replace function public.link_work_artifact_time_segment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_time_segment_id uuid,
  p_description text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_revision_sources%rowtype;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_revision_sources source
  where source.id = p_link_id;
  if found then
    if v_existing.revision_id <> p_revision_id
      or v_existing.time_segment_id is distinct from p_time_segment_id
    then raise exception 'work_artifact_source_idempotency_conflict'; end if;
    select * into v_artifact from public.work_artifacts artifact
    where artifact.id = p_artifact_id;
    return jsonb_build_object('linkId', p_link_id, 'version', v_artifact.version, 'duplicate', true);
  end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version
  then raise exception 'work_artifact_stale_version'; end if;
  if v_artifact.current_revision_id is distinct from p_revision_id
  then raise exception 'work_artifact_relation_requires_current_revision'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;
  insert into public.work_artifact_revision_sources (
    id, organization_id, revision_id, time_segment_id, description, created_by
  ) values (
    p_link_id, p_organization_id, p_revision_id, p_time_segment_id,
    nullif(btrim(p_description), ''), p_actor_id
  );
  v_version := v_artifact.version + 1;
  update public.work_artifacts set version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object('linkId', p_link_id, 'version', v_version, 'duplicate', false);
end;
$$;

revoke all on function public.link_work_artifact_time_segment(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.link_work_artifact_time_segment(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
) to service_role;
