begin;

-- werk-flow/werkflow-planning#447: a person forgets to clock out, files an
-- addition for the same hours, and the office approves it. The server action
-- refuses that addition while the session is open (validateCorrectionTimeline,
-- at the proposal and again at the approval). This file proves the database
-- half: when the forgotten session ends after the office's check, the approval
-- that check allowed is refused, so the day never counts both.

create function pg_temp.timeline_fence() returns jsonb language sql as $$
  select jsonb_build_object('timelineRevision', coalesce((select revision from public.time_timeline_revisions
    where organization_id = '44700000-0000-0000-0000-000000000010'), 0));
$$;
-- New functions are closed by default (migration 20261015100100).
grant execute on all functions in schema pg_temp to service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '44700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'open-session-addition-admin@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Admin","last_name":"Nachtrag"}'::jsonb, now(), now()
),
(
  '44700000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'open-session-addition-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Employee","last_name":"Nachtrag"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '44700000-0000-0000-0000-000000000010', 'Open session addition SQL',
  '44700000-0000-0000-0000-000000000001', 'OSA447SQL'
);
insert into public.organization_members (organization_id, user_id, role)
values (
  '44700000-0000-0000-0000-000000000010',
  '44700000-0000-0000-0000-000000000002', 'employee'
);

set local role service_role;

do $$
declare
  c_org constant uuid := '44700000-0000-0000-0000-000000000010';
  c_admin constant uuid := '44700000-0000-0000-0000-000000000001';
  c_employee constant uuid := '44700000-0000-0000-0000-000000000002';
  v_employee_record uuid;
  v_started_at timestamptz := date_trunc('minute', now() - interval '23 hours');
  v_result jsonb;
  v_session uuid;
  v_version bigint;
  v_request uuid;
  v_fence jsonb;
begin
  select id into v_employee_record from public.employee_records
  where organization_id = c_org and user_id = c_employee;

  -- The clock-in the person forgot to end.
  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000020',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => v_started_at, p_sent_at => now()
  );
  if v_result->>'outcome' is distinct from 'active'
  then raise exception 'the forgotten clock-in did not open a session'; end if;
  v_session := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;

  -- The addition for the same hours, filed while the session is still open.
  v_result := public.create_time_correction_request(
    p_organization_id => c_org,
    p_subject_employee_record_id => v_employee_record,
    p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000030',
    p_kind => 'add', p_reason => 'Ausstempeln vergessen',
    p_source_scope_key => repeat('c', 64),
    p_source_fingerprint => repeat('d', 64),
    p_before_snapshot => '{"schemaVersion":1,"facts":[]}'::jsonb,
    p_proposed_snapshot => jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
      jsonb_build_object('factId', 'start', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_in', 'timestamp', v_started_at,
        'jobId', null, 'activityKind', 'work', 'isManual', true),
      jsonb_build_object('factId', 'end', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_out',
        'timestamp', v_started_at + interval '9 hours',
        'jobId', null, 'activityKind', 'work', 'isManual', true)
    )),
    p_sources => '[]'::jsonb,
    p_responsibility_snapshot => pg_temp.timeline_fence()
  );
  v_request := (v_result->>'requestId')::uuid;
  if v_result->>'status' is distinct from 'submitted'
  then raise exception 'the addition over the open session was not filed for approval'; end if;

  -- The office's check holds this revision. The forgotten session then ends.
  v_fence := pg_temp.timeline_fence();
  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000021',
    p_request_hash => repeat('b', 64), p_action => 'end',
    p_expected_session_id => v_session, p_expected_version => v_version
  );
  if v_result->>'outcome' is distinct from 'ended'
  then raise exception 'the forgotten session did not end'; end if;

  begin
    perform public.decide_time_correction(
      v_request, c_admin, '44700000-0000-0000-0000-000000000040', 1, 'approve', null, v_fence
    );
    raise exception 'an addition checked before its overlapping session ended was approved';
  exception when others then
    if sqlerrm is distinct from 'time_correction_timeline_changed' then raise; end if;
  end;

  if exists (
    select 1 from public.time_correction_applications
    where organization_id = c_org and request_id = v_request
  ) then raise exception 'the refused approval left the addition counted beside the session'; end if;
  if (
    select status from public.time_correction_requests
    where organization_id = c_org and id = v_request
  ) is distinct from 'submitted'
  then raise exception 'the refused approval did not leave the addition open for a new check'; end if;
  if (
    select count(*) from public.time_sessions
    where organization_id = c_org and user_id = c_employee and ended_at is not null
  ) <> 1
  then raise exception 'the forgotten session is not recorded once as ended'; end if;
end;
$$;

rollback;
