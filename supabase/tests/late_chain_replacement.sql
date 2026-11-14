\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
set local role postgres;

-- werk-flow/werkflow-planning#404: a late offline chain on a session the
-- server still holds open is settled by ending that session through the clock
-- and filing a correction that replaces it with the captured times. Once the
-- office approves, the session is closed and the captured span counts once.
-- The late offline end itself stays refused, also when the phone sends it
-- again, so it never counts beside the replacement.
-- 1. A clock-in with signal opened the session 34 hours ago; the person ended
--    work 9 hours later without signal, and the phone is back 25 hours after that.
-- 2. The late end is refused as too old for automatic recording.
-- 3. The guided flow ends the session online (`end`; `recover_end` would be
--    refused on a session the server has not moved to recovery yet).
-- 4. The correction replaces the ended segment with the captured pair, and
--    the office approves it.

create function pg_temp.timeline_fence() returns jsonb language sql as $$
  select jsonb_build_object('timelineRevision', coalesce((select revision from public.time_timeline_revisions
    where organization_id = '40400000-0000-0000-0000-000000000010'), 0));
$$;
grant execute on all functions in schema pg_temp to service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '40400000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'late-chain-admin@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Admin","last_name":"Ersatz"}'::jsonb, now(), now()
),
(
  '40400000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'late-chain-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Monteur","last_name":"Ersatz"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values (
  '40400000-0000-0000-0000-000000000010', 'Late chain replacement SQL',
  '40400000-0000-0000-0000-000000000001', 'LCR404SQL'
);
insert into public.organization_members (organization_id, user_id, role)
values ('40400000-0000-0000-0000-000000000010', '40400000-0000-0000-0000-000000000002', 'employee');

set local role service_role;

-- 1. The clock-in with signal, 34 hours ago. The server stamps an online start
-- now, so the fixture moves the recorded start back, with the append-only
-- guards off for that one write.
do $$
begin
  perform public.transition_time_activity(
    p_organization_id => '40400000-0000-0000-0000-000000000010',
    p_actor_id => '40400000-0000-0000-0000-000000000002',
    p_operation_id => '40400000-0000-0000-0000-000000000020',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
end;
$$;

set local role postgres;
set local session_replication_role = replica;
update public.time_sessions set started_at = date_trunc('minute', now() - interval '34 hours')
where user_id = '40400000-0000-0000-0000-000000000002';
update public.time_segments set started_at = date_trunc('minute', now() - interval '34 hours')
where organization_id = '40400000-0000-0000-0000-000000000010';
update public.time_segment_events set occurred_at = date_trunc('minute', now() - interval '34 hours')
where organization_id = '40400000-0000-0000-0000-000000000010';
set local session_replication_role = origin;
set local role service_role;

do $$
declare
  c_org constant uuid := '40400000-0000-0000-0000-000000000010';
  c_admin constant uuid := '40400000-0000-0000-0000-000000000001';
  c_employee constant uuid := '40400000-0000-0000-0000-000000000002';
  v_started_at timestamptz := date_trunc('minute', now() - interval '34 hours');
  v_captured_end timestamptz := date_trunc('minute', now() - interval '25 hours');
  v_employee_record uuid;
  v_result jsonb;
  v_session uuid;
  v_segment uuid;
  v_version bigint;
  v_segment_version text;
  v_request uuid;
  v_facts jsonb;
  v_counted interval;
  v_recorded_end timestamptz;
  v_read_before jsonb;
begin
  select id into v_employee_record from public.employee_records
  where organization_id = c_org and user_id = c_employee;

  select id, version into v_session, v_version from public.time_sessions
  where organization_id = c_org and user_id = c_employee;
  select id into v_segment from public.time_segments where session_id = v_session;

  -- 2. The phone's end, captured 25 hours ago, is too old to be recorded by itself.
  begin
    perform public.transition_time_activity(
      p_organization_id => c_org, p_actor_id => c_employee,
      p_operation_id => '40400000-0000-0000-0000-000000000021',
      p_request_hash => repeat('b', 64), p_action => 'end',
      p_expected_session_id => v_session, p_expected_version => v_version,
      p_captured_at => v_captured_end, p_sent_at => now()
    );
    raise exception 'the late offline end was recorded';
  exception when others then
    if sqlerrm <> 'time_transition_correction_required' then raise; end if;
  end;

  -- 3. The guided flow ends the session online.
  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '40400000-0000-0000-0000-000000000022',
    p_request_hash => repeat('c', 64), p_action => 'end',
    p_expected_session_id => v_session, p_expected_version => v_version
  );
  if v_result->>'outcome' is distinct from 'ended'
  then raise exception 'the guided flow did not end the open session: %', v_result; end if;
  if (select status from public.time_sessions where id = v_session) is distinct from 'closed'
  then raise exception 'the ended session is not closed'; end if;

  -- 4. The replacement: the ended segment, edited to the captured pair (one day piece each side of midnight).
  -- Its before snapshot holds the segment as recorded, up to the online end, as the correction form files it.
  select ended_at into v_recorded_end from public.time_segments where id = v_segment;
  perform set_config('TimeZone', 'UTC', true);
  select updated_at::text into v_segment_version from public.time_segments where id = v_segment;
  perform set_config('TimeZone', 'Europe/Berlin', true);
  select jsonb_agg(fact order by ordinal) into v_facts
  from (
    select ordinal, jsonb_build_object('factId', 'f' || ordinal, 'employeeRecordId', v_employee_record,
      'userId', c_employee, 'entryType', entry_type, 'timestamp', at,
      'jobId', null, 'activityKind', 'work', 'isManual', false) fact
    from (
      select 1 ordinal, 'clock_in' entry_type, v_started_at at
      union all
      select 2, 'clock_out', least(v_captured_end, (date_trunc('day', v_started_at at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin')
      union all
      select 3, 'clock_in', (date_trunc('day', v_started_at at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin'
      where (date_trunc('day', v_started_at at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin' < v_captured_end
      union all
      select 4, 'clock_out', v_captured_end
      where (date_trunc('day', v_started_at at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin' < v_captured_end
    ) pieces
  ) facts;
  v_result := public.create_time_correction_request(
    p_organization_id => c_org,
    p_subject_employee_record_id => v_employee_record,
    p_actor_id => c_employee,
    p_operation_id => '40400000-0000-0000-0000-000000000030',
    p_kind => 'edit', p_reason => 'Ohne Netz erfasstes Ende',
    p_source_scope_key => repeat('d', 64),
    p_source_fingerprint => repeat('e', 64),
    p_before_snapshot => jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
      jsonb_build_object('factId', 'b1', 'employeeRecordId', v_employee_record, 'userId', c_employee,
        'entryType', 'clock_in', 'timestamp', v_started_at, 'jobId', null, 'activityKind', 'work',
        'isManual', false),
      jsonb_build_object('factId', 'b2', 'employeeRecordId', v_employee_record, 'userId', c_employee,
        'entryType', 'clock_out', 'timestamp', v_recorded_end, 'jobId', null, 'activityKind', 'work',
        'isManual', false))),
    p_proposed_snapshot => jsonb_build_object('schemaVersion', 1, 'facts', v_facts),
    p_sources => jsonb_build_array(jsonb_build_object(
      'kind', 'canonical_segment', 'id', v_segment, 'version', v_segment_version)),
    p_responsibility_snapshot => pg_temp.timeline_fence()
  );
  v_request := (v_result->>'requestId')::uuid;
  if v_result->>'status' is distinct from 'submitted'
  then raise exception 'the replacement was not filed for approval: %', v_result; end if;

  perform public.decide_time_correction(
    v_request, c_admin, '40400000-0000-0000-0000-000000000040', 1, 'approve', null,
    pg_temp.timeline_fence()
  );

  -- The approved replacement names exactly the ended segment and counts exactly the captured span.
  if (select count(*) from public.time_correction_request_sources
      where request_id = v_request and time_segment_id = v_segment) <> 1
    or (select count(*) from public.time_correction_request_sources where request_id = v_request) <> 1
  then raise exception 'the replacement does not replace exactly the ended segment'; end if;
  select sum(clock_out.at - clock_in.at) into v_counted
  from (
    select (fact.value->>'timestamp')::timestamptz at, row_number() over (order by fact.ordinality) n
    from public.time_correction_applications application,
      jsonb_array_elements(application.applied_snapshot->'facts') with ordinality fact(value, ordinality)
    where application.request_id = v_request and fact.value->>'entryType' = 'clock_in'
  ) clock_in
  join (
    select (fact.value->>'timestamp')::timestamptz at, row_number() over (order by fact.ordinality) n
    from public.time_correction_applications application,
      jsonb_array_elements(application.applied_snapshot->'facts') with ordinality fact(value, ordinality)
    where application.request_id = v_request and fact.value->>'entryType' = 'clock_out'
  ) clock_out using (n);
  if v_counted is distinct from interval '9 hours'
  then raise exception 'the approved replacement counts % instead of the captured 9 hours', v_counted; end if;
  if (select status from public.time_sessions where id = v_session) is distinct from 'closed'
  then raise exception 'the session reopened'; end if;

  -- The reader the time views use returns the approved application also for a window after the
  -- captured span, where only the recorded end lies: its before snapshot holds the ended segment, so
  -- the views suppress the segment there instead of counting it beside the replacement.
  select application.before_snapshot into v_read_before
  from public.read_time_correction_applications(
    c_org, array[c_employee], v_captured_end + interval '1 hour', now()
  ) application
  where application.request_id = v_request;
  if v_read_before is null
  then raise exception 'the reader misses the replacement after the captured span, so the ended segment counts twice'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_read_before->'facts') fact
    where fact->>'entryType' = 'clock_out' and (fact->>'timestamp')::timestamptz = v_recorded_end
  ) or (select count(*) from public.time_correction_request_sources
        where request_id = v_request and time_segment_id = v_segment) <> 1
  then raise exception 'the read replacement does not hold and suppress the ended segment: %', v_read_before; end if;

  -- The phone's late end, sent once more, still records nothing beside the replacement.
  begin
    perform public.transition_time_activity(
      p_organization_id => c_org, p_actor_id => c_employee,
      p_operation_id => '40400000-0000-0000-0000-000000000023',
      p_request_hash => repeat('f', 64), p_action => 'end',
      p_expected_session_id => v_session, p_expected_version => v_version,
      p_captured_at => v_captured_end, p_sent_at => now()
    );
    raise exception 'the late offline end was recorded after the replacement';
  exception when others then
    if sqlerrm <> 'time_transition_correction_required' then raise; end if;
  end;
end;
$$;

rollback;
