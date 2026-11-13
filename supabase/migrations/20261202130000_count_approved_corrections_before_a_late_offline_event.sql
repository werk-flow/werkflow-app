-- A late offline event never lands inside time an approved correction added
-- (werk-flow/werkflow-planning#447; owner decision 2026-11-13).
--
-- A clock event captured without signal is refused with
-- time_transition_captured_out_of_order when it lies before the person's last
-- recorded time (20261128090001). That time read sessions and time entries
-- only. A correction the office approved before the phone sent its event was
-- missed, so both the correction and the late session counted. The latest
-- fact of each current application now counts as recorded time too. The phone
-- shows the refusal as „Konflikt“, and the person deletes the event or files
-- a correction.
--
-- The rest of the function is unchanged from 20261128090001. It keeps its
-- signature, owner and grants (create or replace); the revoke restates them.
-- The read is scoped to the person's organizations and runs only for an
-- offline-captured event.

create or replace function app_private.transition_time_activity(
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
  p_acknowledge_long boolean default false,
  p_captured_at timestamptz default null,
  p_sent_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  -- The offline time window (decision record 0010). Change a value here, never on a device.
  c_clock_skew_tolerance constant interval := interval '5 minutes';
  c_automatic_window constant interval := interval '24 hours';
  c_recording_deadline constant interval := interval '7 days';
  v_now timestamptz := clock_timestamp();
  -- The recorded time of the user's act: the server clock online; offline the
  -- captured time, capped at the receipt (least ignores a null), so a later
  -- online transition never ends a segment before it started. Every check on
  -- the captured time (closed period, window, order) reads p_captured_at.
  v_at timestamptz := least(p_captured_at, v_now);
  v_captured_date date;
  v_last_recorded_at timestamptz;
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
    or (p_captured_at is null) <> (p_sent_at is null)
  then raise exception 'time_transition_invalid_input'; end if;
  if p_captured_at is not null and p_action not in ('start', 'switch', 'end')
  then raise exception 'time_transition_action_invalid'; end if;

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

  if p_captured_at is not null then
    v_captured_date := (p_captured_at at time zone 'Europe/Berlin')::date;
    perform app_private.assert_time_facts_period_open(
      p_organization_id, v_captured_date, v_captured_date
    );
    if p_captured_at > v_now + c_clock_skew_tolerance
    then raise exception 'time_transition_captured_in_future'; end if;
    if v_now - p_captured_at > c_recording_deadline
    then raise exception 'time_transition_outside_recording_window'; end if;
    if v_now - p_captured_at > c_automatic_window
    then raise exception 'time_transition_correction_required'; end if;
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

  if p_captured_at is not null then
    -- The person's latest recorded time in any organization, so a late event
    -- never overlaps time recorded since, also elsewhere. Across every
    -- session: two sessions can start at the same instant. The refusal names
    -- no other organization.
    select max(event.occurred_at) into v_last_recorded_at
    from public.employee_records employee
    join public.time_sessions session
      on session.organization_id = employee.organization_id
      and session.employee_record_id = employee.id
    join public.time_segment_events event
      on event.session_id = session.id and event.organization_id = session.organization_id
    where employee.user_id = p_actor_id;
    select greatest(v_last_recorded_at, max(entry.timestamp)) into v_last_recorded_at
    from public.time_entries entry
    where entry.user_id = p_actor_id
      and entry.status not in ('rejected', 'pending_delete');
    -- Time an approved correction gave the person is recorded time too
    -- (werk-flow/werkflow-planning#447). A replaced application no longer counts.
    select greatest(v_last_recorded_at, max((fact.value ->> 'timestamp')::timestamptz))
    into v_last_recorded_at
    from public.time_correction_applications application
    cross join lateral jsonb_array_elements(application.applied_snapshot -> 'facts') fact
    where application.organization_id in (
        select employee.organization_id from public.employee_records employee
        where employee.user_id = p_actor_id
      )
      and application.applied_snapshot -> 'facts'
        @> jsonb_build_array(jsonb_build_object('userId', p_actor_id))
      and fact.value ->> 'userId' = p_actor_id::text
      and not exists (
        select 1 from public.time_correction_applications later
        where later.previous_application_id = application.id
      );
    if p_captured_at < v_last_recorded_at
    then raise exception 'time_transition_captured_out_of_order'; end if;
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
    and v_at - v_session.started_at > interval '24 hours'
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
      resulting_session_id, resulting_segment_id, resulting_version, result_payload,
      captured_at, sent_at
    ) values (
      p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
      p_request_hash, p_expected_session_id, p_expected_version,
      v_session.id, v_segment.id, v_session.version, v_result,
      p_captured_at, p_sent_at
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
      'open', v_at, 1, p_actor_id
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
        resulting_session_id, resulting_segment_id, resulting_version, result_payload,
        captured_at, sent_at
      ) values (
        p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
        p_request_hash, p_expected_session_id, p_expected_version,
        v_session.id, v_segment.id, v_session.version, v_result,
        p_captured_at, p_sent_at
      );
      perform set_config('app.time_capture_write', 'false', true);
      return v_result;
    end if;

    if v_segment.id is not null then
      update public.time_segments
      set ended_at = v_at, end_source = 'employee', ended_by = p_actor_id,
          updated_at = v_now
      where id = v_segment.id;
      insert into public.time_segment_events (
        organization_id, session_id, segment_id, operation_id, event_type,
        source, actor_id, occurred_at
      ) values (
        p_organization_id, v_session.id, v_segment.id, p_operation_id,
        'segment_ended', 'employee', p_actor_id, v_at
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
      set ended_at = v_at,
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
        p_actor_id, v_at
      );
    end if;
    update public.time_sessions
    set status = 'closed', ended_at = v_at, ended_by = p_actor_id,
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
      p_actor_id, v_at
    );
    v_result := jsonb_build_object(
      'outcome', 'ended', 'sessionId', v_session.id,
      'segmentId', v_segment.id, 'version', v_session.version,
      'legacyBridged', false, 'replayed', false
    );
    insert into public.time_operations (
      id, organization_id, employee_record_id, actor_id, operation_kind,
      request_hash, expected_session_id, expected_version,
      resulting_session_id, resulting_segment_id, resulting_version, result_payload,
      captured_at, sent_at
    ) values (
      p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
      p_request_hash, p_expected_session_id, p_expected_version,
      v_session.id, v_segment.id, v_session.version, v_result,
      p_captured_at, p_sent_at
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
    p_travel_route, p_travel_role, p_standby_context, v_at,
    v_source, p_actor_id
  ) returning * into v_segment;

  if p_action in ('start', 'continue_legacy') then
    insert into public.time_segment_events (
      organization_id, session_id, operation_id, event_type,
      source, actor_id, occurred_at
    ) values (
      p_organization_id, v_session.id, p_operation_id, 'session_started',
      v_source, p_actor_id, v_at
    );
  end if;
  insert into public.time_segment_events (
    organization_id, session_id, segment_id, operation_id, event_type,
    source, actor_id, occurred_at
  ) values (
    p_organization_id, v_session.id, v_segment.id, p_operation_id,
    'segment_started', v_source, p_actor_id, v_at
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
    resulting_session_id, resulting_segment_id, resulting_version, result_payload,
    captured_at, sent_at
  ) values (
    p_operation_id, p_organization_id, v_employee.id, p_actor_id, p_action,
    p_request_hash, p_expected_session_id, p_expected_version,
    v_session.id, v_segment.id, v_session.version, v_result,
    p_captured_at, p_sent_at
  );
  perform set_config('app.time_capture_write', 'false', true);
  return v_result;
end;
$$;

revoke all on function app_private.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
