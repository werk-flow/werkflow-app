begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '21000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"P1","last_name":"21"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '21000000-0000-0000-0000-000000000002', 'P1-21 SQL',
  '21000000-0000-0000-0000-000000000001', 'P121SQL'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '21000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-target@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Target","last_name":"Member"}'::jsonb, now(), now()
);
insert into public.organization_members (organization_id, user_id, role)
values (
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000003', 'employee'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '21000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-buero-a@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Buero","last_name":"A"}'::jsonb, now(), now()
),
(
  '21000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-buero-b@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Buero","last_name":"B"}'::jsonb, now(), now()
),
(
  '21000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-employee-b@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Employee","last_name":"B"}'::jsonb, now(), now()
),
(
  '21000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-without-time@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Without","last_name":"Time"}'::jsonb, now(), now()
);
insert into public.organization_members (organization_id, user_id, role)
values
(
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000005', 'buero'
),
(
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000006', 'buero'
),
(
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000007', 'employee'
),
(
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000009', 'employee'
);

-- Exercise the same deployment role as the Server Action. This catches a
-- missing grant on any private helper called by the public service-only RPC.
set local role service_role;

do $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_version bigint;
  v_segment_count integer;
  v_previous_capture_write text;
  v_legacy_entry public.time_entries%rowtype;
  v_session_before jsonb;
  v_segments_before jsonb;
  v_events_before jsonb;
begin
  if to_regprocedure(
    'public.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean,timestamptz,timestamptz)'
  ) is null or to_regprocedure(
    'app_private.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean,timestamptz,timestamptz)'
  ) is null then raise exception 'serialized transition wrapper is incomplete'; end if;
  if pg_get_functiondef(to_regprocedure(
    'public.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean,timestamptz,timestamptz)'
  )) not like '%pg_advisory_xact_lock%'
  then raise exception 'serialized transition lock is missing'; end if;
  if has_function_privilege(
    'service_role',
    'app_private.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean,timestamptz,timestamptz)',
    'EXECUTE'
  ) then raise exception 'private transition implementation is executable'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000010',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  if v_result->>'outcome' <> 'active' then raise exception 'start failed'; end if;
  v_session_id := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;
  if v_version <> 1
    or (select count(*) from public.time_segments where session_id = v_session_id) <> 1
  then raise exception 'start did not open exactly one segment at session version 1'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000010',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  if (v_result->>'replayed')::boolean is not true
    or (v_result->>'sessionId')::uuid <> v_session_id
    or v_result->>'outcome' <> 'active'
  then raise exception 'replay failed'; end if;

  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000002',
      p_actor_id => '21000000-0000-0000-0000-000000000001',
      p_operation_id => '21000000-0000-0000-0000-000000000010',
      p_request_hash => repeat('b', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated'
    );
    raise exception 'idempotency conflict was accepted';
  exception when others then
    if sqlerrm not like '%time_transition_idempotency_conflict%'
    then raise; end if;
  end;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000011',
    p_request_hash => repeat('b', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'travel', p_allocation_kind => 'unallocated',
    p_travel_route => 'company_to_site', p_travel_role => 'driver'
  );
  v_version := (v_result->>'version')::bigint;

  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000002',
      p_actor_id => '21000000-0000-0000-0000-000000000001',
      p_operation_id => '21000000-0000-0000-0000-000000000012',
      p_request_hash => repeat('c', 64), p_action => 'switch',
      p_expected_session_id => v_session_id, p_expected_version => v_version - 1,
      p_segment_kind => 'break', p_allocation_kind => 'none'
    );
    raise exception 'stale version was accepted';
  exception when others then
    if sqlerrm not like '%time_transition_stale_version%' then raise; end if;
  end;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000013',
    p_request_hash => repeat('d', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'break', p_allocation_kind => 'none'
  );
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000014',
    p_request_hash => repeat('e', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'standby', p_allocation_kind => 'none',
    p_standby_context => 'remote'
  );
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000015',
    p_request_hash => repeat('f', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'callout', p_allocation_kind => 'unallocated'
  );
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000016',
    p_request_hash => repeat('a', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'internal_activity', p_allocation_kind => 'internal_activity',
    p_internal_type => 'training'
  );
  v_version := (v_result->>'version')::bigint;
  if v_version <> 6
  then raise exception 'five accepted switches did not advance the session to version 6'; end if;
  if (select count(*) from public.time_operations where resulting_session_id = v_session_id) <> 6
  then raise exception 'each accepted transition did not record exactly one operation'; end if;

  select count(*) into v_segment_count from public.time_segments
  where session_id = v_session_id;
  if v_segment_count <> 6 then raise exception 'six-kind chain was not preserved'; end if;
  if (select count(*) from public.time_segments where session_id = v_session_id and ended_at is null) <> 1
  then raise exception 'open segment uniqueness failed'; end if;
  if exists (
    select 1
    from (
      select event_sequence,
        lag(event_sequence) over (order by occurred_at, event_sequence) as previous_sequence
      from public.time_segment_events
      where session_id = v_session_id
    ) ordered_events
    where previous_sequence is not null
      and event_sequence <= previous_sequence
  ) then raise exception 'event sequence did not preserve append order'; end if;

  v_previous_capture_write := coalesce(
    current_setting('app.time_capture_write', true), ''
  );
  perform set_config('app.time_capture_write', 'true', true);
  update public.time_sessions set started_at = now() - interval '25 hours'
  where id = v_session_id;
  perform set_config(
    'app.time_capture_write', v_previous_capture_write, true
  );
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000017',
    p_request_hash => repeat('b', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  if v_result->>'outcome' <> 'recovery_required' then raise exception 'long recovery missing'; end if;
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000018',
    p_request_hash => repeat('c', 64), p_action => 'recover_continue',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_acknowledge_long => true
  );
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000019',
    p_request_hash => repeat('d', 64), p_action => 'end',
    p_expected_session_id => v_session_id, p_expected_version => v_version
  );
  if v_result->>'outcome' <> 'ended' then raise exception 'end failed'; end if;
  if (select status from public.time_sessions where id = v_session_id) <> 'closed'
    or exists (
      select 1 from public.time_segments where session_id = v_session_id and ended_at is null
    )
  then raise exception 'end left the session or one of its segments open'; end if;
  if (
      select count(*) from public.time_segment_events
      where session_id = v_session_id and event_type = 'segment_started'
    ) <> (select count(*) from public.time_segments where session_id = v_session_id)
    or (
      select count(*) from public.time_segment_events
      where session_id = v_session_id and event_type = 'segment_ended'
    ) <> (select count(*) from public.time_segments where session_id = v_session_id)
  then raise exception 'segment start and end events do not match the segments one to one'; end if;
  if (
    select event_type from public.time_segment_events
    where session_id = v_session_id
    order by event_sequence desc limit 1
  ) <> 'session_ended'
  then raise exception 'session_ended is not the last event of the closed session'; end if;

  begin
    perform set_config('app.time_capture_write', 'true', true);
    update public.time_operations set request_hash = repeat('e', 64)
    where id = '21000000-0000-0000-0000-000000000019';
    raise exception 'append-only update was accepted';
  exception when others then
    if sqlerrm not like '%time_capture_append_only%' then raise; end if;
  end;

  insert into public.time_entries (
    user_id, organization_id, entry_type, timestamp, is_manual, status
  ) values (
    '21000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000002',
    'clock_in', now(), false, 'approved'
  );
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000020',
    p_request_hash => repeat('e', 64), p_action => 'continue_legacy',
    p_segment_kind => 'standby', p_allocation_kind => 'none',
    p_standby_context => 'unspecified'
  );
  if (v_result->>'legacyBridged')::boolean is not true
  then raise exception 'legacy continuation was not bridged'; end if;
  v_session_id := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;
  if not exists (
    select 1 from public.time_entries
    where organization_id = '21000000-0000-0000-0000-000000000002'
      and user_id = '21000000-0000-0000-0000-000000000001'
      and entry_type = 'clock_out'
      and capture_source = 'legacy_compatibility'
  )
  then raise exception 'legacy session was not closed'; end if;
  if (select count(*) from public.time_segments where session_id = v_session_id) <> 1
    or exists (
      select 1 from public.time_segments
      where session_id = v_session_id
        and (kind <> 'standby' or start_source <> 'legacy_compatibility')
    )
  then raise exception 'legacy continuation did not open exactly one attributed standby segment'; end if;
  if exists (
    select 1 from public.time_segments segment
    where segment.session_id = v_session_id
      and segment.started_at < (
        select max(entry.timestamp) from public.time_entries entry
        where entry.organization_id = '21000000-0000-0000-0000-000000000002'
          and entry.user_id = '21000000-0000-0000-0000-000000000001'
          and entry.entry_type = 'clock_out'
          and entry.capture_source = 'legacy_compatibility'
      )
  ) then raise exception 'legacy continuation backfilled a segment before the legacy close'; end if;
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000021',
    p_request_hash => repeat('f', 64), p_action => 'end',
    p_expected_session_id => v_session_id, p_expected_version => v_version
  );
  -- The clock offers only what deriveClockActions derives (lib/ui/action-prechecks.ts):
  -- no switch without an open session.
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000002',
      p_actor_id => '21000000-0000-0000-0000-000000000001',
      p_operation_id => '21000000-0000-0000-0000-000000000041',
      p_request_hash => repeat('c', 64), p_action => 'switch',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated'
    );
    raise exception 'a switch was accepted without an open session';
  exception when others then
    if sqlerrm not like '%time_transition_not_open%' then raise; end if;
  end;

  insert into public.organization_settings (organization_id, break_mode)
  values ('21000000-0000-0000-0000-000000000002', 'automatic')
  on conflict (organization_id) do update set break_mode = excluded.break_mode;
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000002',
      p_actor_id => '21000000-0000-0000-0000-000000000001',
      p_operation_id => '21000000-0000-0000-0000-000000000022',
      p_request_hash => repeat('a', 64), p_action => 'start',
      p_segment_kind => 'break', p_allocation_kind => 'none'
    );
    raise exception 'manual break was accepted in automatic mode';
  exception when others then
    if sqlerrm not like '%time_transition_break_mode_automatic%' then raise; end if;
  end;

  begin
    insert into public.time_sessions (
      organization_id, employee_record_id, user_id, started_at, created_by
    ) select
      '21000000-0000-0000-0000-000000000002', employee.id,
      '21000000-0000-0000-0000-000000000001', now(),
      '21000000-0000-0000-0000-000000000001'
    from public.employee_records employee
    where employee.organization_id = '21000000-0000-0000-0000-000000000002'
      and employee.user_id = '21000000-0000-0000-0000-000000000001';
    raise exception 'direct canonical write was accepted';
  exception when others then
    if sqlerrm not like '%time_capture_direct_write_forbidden%' then raise; end if;
  end;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000003',
    p_operation_id => '21000000-0000-0000-0000-000000000030',
    p_request_hash => repeat('b', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  v_session_id := (v_result->>'sessionId')::uuid;
  -- No second start while the session is open, even with its current version.
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000002',
      p_actor_id => '21000000-0000-0000-0000-000000000003',
      p_operation_id => '21000000-0000-0000-0000-000000000042',
      p_request_hash => repeat('d', 64), p_action => 'start',
      p_expected_session_id => v_session_id, p_expected_version => (v_result->>'version')::bigint,
      p_segment_kind => 'work', p_allocation_kind => 'unallocated'
    );
    raise exception 'a second start was accepted while a session was open';
  exception when others then
    if sqlerrm not like '%time_transition_already_open%' then raise; end if;
  end;
  -- Authorization is tested against a history-free target so SI-006's earlier
  -- history refusal does not hide the authorization boundary.
  begin
    perform public.remove_member_with_time_capture(
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000009',
      '21000000-0000-0000-0000-000000000099',
      '21000000-0000-0000-0000-000000000032'
    );
    raise exception 'non-member actor removed a member';
  exception when others then
    if sqlerrm not like '%time_member_removal_not_authorized%' then raise; end if;
  end;
  begin
    perform public.remove_member_with_time_capture(
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000006',
      '21000000-0000-0000-0000-000000000005',
      '21000000-0000-0000-0000-000000000033'
    );
    raise exception 'buero actor removed a peer';
  exception when others then
    if sqlerrm not like '%time_member_removal_not_authorized%' then raise; end if;
  end;
  begin
    perform public.remove_member_with_time_capture(
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000098',
      '21000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000034'
    );
    raise exception 'unknown target was removed';
  exception when others then
    if sqlerrm not like '%time_member_removal_target_missing%' then raise; end if;
  end;
  if public.remove_member_with_time_capture(
    '21000000-0000-0000-0000-000000000002',
    '21000000-0000-0000-0000-000000000009',
    '21000000-0000-0000-0000-000000000005',
    '21000000-0000-0000-0000-000000000036'
  ) is distinct from false then raise exception 'history-free removal reported a closed session'; end if;
  if exists (
    select 1 from public.organization_members
    where organization_id = '21000000-0000-0000-0000-000000000002'
      and user_id = '21000000-0000-0000-0000-000000000009'
  ) then raise exception 'buero removal left the history-free employee membership'; end if;

  -- SI-006 preserves recorded time and membership instead of deleting history.
  insert into public.time_entries (
    user_id, organization_id, entry_type, timestamp, is_manual, status
  ) values (
    '21000000-0000-0000-0000-000000000007',
    '21000000-0000-0000-0000-000000000002',
    'clock_in', now(), false, 'approved'
  ) returning * into v_legacy_entry;
  begin
    perform public.remove_member_with_time_capture(
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000007',
      '21000000-0000-0000-0000-000000000005',
      '21000000-0000-0000-0000-000000000035'
    );
    raise exception 'buero removed an employee with legacy time';
  exception when raise_exception then
    if sqlerrm <> 'time_member_removal_has_history' then raise; end if;
  end;
  if not exists (
    select 1 from public.organization_members
    where organization_id = '21000000-0000-0000-0000-000000000002'
      and user_id = '21000000-0000-0000-0000-000000000007'
  ) then raise exception 'legacy-history refusal removed the employee membership'; end if;
  if (select to_jsonb(entry) from public.time_entries entry where id = v_legacy_entry.id)
    is distinct from to_jsonb(v_legacy_entry)
  then raise exception 'legacy-history refusal changed recorded time'; end if;

  select to_jsonb(session) into v_session_before from public.time_sessions session where id = v_session_id;
  select jsonb_agg(to_jsonb(segment) order by id) into v_segments_before
    from public.time_segments segment where session_id = v_session_id;
  select jsonb_agg(to_jsonb(event) order by id) into v_events_before
    from public.time_segment_events event where session_id = v_session_id;
  if v_session_before is null or v_session_before->>'ended_at' is not null
    or v_segments_before is null or v_events_before is null
  then raise exception 'canonical history fixture is missing its open session, segments, or events'; end if;
  perform set_config('app.time_capture_write', 'outer_scope', true);
  begin
    perform public.remove_member_with_time_capture(
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000003',
      '21000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000031'
    );
    raise exception 'admin removed a member with a canonical session';
  exception when raise_exception then
    if sqlerrm <> 'time_member_removal_has_history' then raise; end if;
  end;
  if current_setting('app.time_capture_write', true) <> 'outer_scope'
  then raise exception 'history refusal changed capture scope'; end if;
  if (select to_jsonb(session) from public.time_sessions session where id = v_session_id)
    is distinct from v_session_before
    or (select jsonb_agg(to_jsonb(segment) order by id) from public.time_segments segment where session_id = v_session_id)
      is distinct from v_segments_before
    or (select jsonb_agg(to_jsonb(event) order by id) from public.time_segment_events event where session_id = v_session_id)
      is distinct from v_events_before
  then raise exception 'history refusal changed the session, segments, or events'; end if;
  if exists (select 1 from public.time_operations
    where id = '21000000-0000-0000-0000-000000000031')
  then raise exception 'history refusal recorded a removal operation'; end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = '21000000-0000-0000-0000-000000000002'
      and user_id = '21000000-0000-0000-0000-000000000003'
  ) then raise exception 'canonical-history refusal removed the membership'; end if;
end;
$$;

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '21000000-0000-0000-0000-000000000008', 'P1-21 Batch Cascade',
  '21000000-0000-0000-0000-000000000001', 'P121BAT'
);
do $$
begin
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000008',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000038',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
end;
$$;
delete from public.organizations
where id in (
  '21000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000008'
);
do $$
begin
  if exists (select 1 from public.time_sessions where organization_id in (
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000008'
    )) or exists (select 1 from public.time_segments where organization_id in (
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000008'
    )) or exists (select 1 from public.time_operations where organization_id in (
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000008'
    )) or exists (select 1 from public.time_segment_events where organization_id in (
      '21000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000008'
    ))
  then raise exception 'organization cascade left canonical time rows'; end if;
  if coalesce(current_setting(
    'app.time_capture_cascade_organization_ids', true
  ), '') <> '' then raise exception 'organization cascade marker was not cleared'; end if;
end;
$$;

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '21000000-0000-0000-0000-000000000004', 'P1-21 Scope',
  '21000000-0000-0000-0000-000000000001', 'P121SCP'
);
do $$
declare
  v_result jsonb;
begin
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000004',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000040',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  begin
    delete from public.time_sessions
    where id = (v_result->>'sessionId')::uuid;
    raise exception 'cross-organization cascade marker allowed direct delete';
  exception when others then
    if sqlerrm not like '%time_capture_direct_write_forbidden%' then raise; end if;
  end;
end;
$$;
delete from public.organizations
where id = '21000000-0000-0000-0000-000000000004';

-- P1-21-F57: job-linked travel never starts job execution; a job-linked
-- call-out starts it with the time actor as the attributed origin.
insert into public.organizations (id, name, admin_id, unique_code)
values (
  '21000000-0000-0000-0000-000000000012', 'P1-21 Job Start',
  '21000000-0000-0000-0000-000000000001', 'P121JOB'
);
insert into public.jobs (id, organization_id, title, job_number, created_by)
values (
  '21000000-0000-0000-0000-000000000013', '21000000-0000-0000-0000-000000000012',
  'P1-21 Ausführung', 'P121-JOB', '21000000-0000-0000-0000-000000000001'
);
do $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_version bigint;
begin
  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000012',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000050',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'travel', p_allocation_kind => 'job',
    p_job_id => '21000000-0000-0000-0000-000000000013',
    p_travel_route => 'home_to_site', p_travel_role => 'passenger'
  );
  v_session_id := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;
  if not exists (
    select 1 from public.time_segments
    where session_id = v_session_id and kind = 'travel' and allocation_kind = 'job'
      and travel_route = 'home_to_site' and travel_role = 'passenger'
  ) then raise exception 'job-linked travel lost its route, role or allocation'; end if;
  if exists (
    select 1 from public.work_execution_events
    where job_id = '21000000-0000-0000-0000-000000000013'
  ) then raise exception 'job-linked travel started job execution'; end if;
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000012',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000051',
    p_request_hash => repeat('b', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'callout', p_allocation_kind => 'job',
    p_job_id => '21000000-0000-0000-0000-000000000013'
  );
  if not exists (
    select 1 from public.work_execution_events
    where job_id = '21000000-0000-0000-0000-000000000013'
      and event_type = 'automatic_time_start'
      and created_by = '21000000-0000-0000-0000-000000000001'
  ) then raise exception 'job-linked call-out did not start attributed job execution'; end if;
end;
$$;

-- werk-flow/werkflow-planning#317: a transition captured on a phone without
-- signal is recorded once, at its captured time, and only inside the offline
-- window (decision record 0010). An online call keeps the server clock.
reset role;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('21000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offline-admin@example.test', '', now(), '{}',
 '{"first_name":"Offline","last_name":"Admin"}', now(), now()),
('21000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offline-field@example.test', '', now(), '{}',
 '{"first_name":"Offline","last_name":"Field"}', now(), now()),
('21000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offline-leaver@example.test', '', now(), '{}',
 '{"first_name":"Offline","last_name":"Leaver"}', now(), now()),
('21000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offline-twin@example.test', '', now(), '{}',
 '{"first_name":"Offline","last_name":"Twin"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('21000000-0000-0000-0000-000000000710', 'Offline capture SQL',
  '21000000-0000-0000-0000-000000000701', 'OFFLNSQL'),
('21000000-0000-0000-0000-000000000711', 'Offline foreign SQL',
  '21000000-0000-0000-0000-000000000701', 'OFFLNFRN');
insert into public.organization_members (organization_id, user_id, role) values
('21000000-0000-0000-0000-000000000710', '21000000-0000-0000-0000-000000000702', 'employee'),
('21000000-0000-0000-0000-000000000710', '21000000-0000-0000-0000-000000000703', 'employee'),
('21000000-0000-0000-0000-000000000710', '21000000-0000-0000-0000-000000000704', 'employee'),
('21000000-0000-0000-0000-000000000711', '21000000-0000-0000-0000-000000000704', 'employee');
insert into public.jobs (id, organization_id, title, job_number, created_by)
values (
  '21000000-0000-0000-0000-000000000712', '21000000-0000-0000-0000-000000000710',
  'Offline unassigned job', 'OFFLINE-JOB', '21000000-0000-0000-0000-000000000701'
), (
  '21000000-0000-0000-0000-000000000713', '21000000-0000-0000-0000-000000000710',
  'Offline blocked job', 'OFFLINE-BLOCKED', '21000000-0000-0000-0000-000000000701'
);
-- The office blocked an assigned job while the phone was offline.
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values (
  '21000000-0000-0000-0000-000000000710', '21000000-0000-0000-0000-000000000713',
  '21000000-0000-0000-0000-000000000702', '21000000-0000-0000-0000-000000000701'
);
insert into public.work_blockers (organization_id, job_id, is_legacy) values (
  '21000000-0000-0000-0000-000000000710', '21000000-0000-0000-0000-000000000713', true
);
set local role service_role;

do $$
declare
  v_org constant uuid := '21000000-0000-0000-0000-000000000710';
  v_field constant uuid := '21000000-0000-0000-0000-000000000702';
  v_start_at constant timestamptz := clock_timestamp() - interval '3 hours';
  v_switch_at constant timestamptz := clock_timestamp() - interval '2 hours';
  v_end_at constant timestamptz := clock_timestamp() - interval '1 hour';
  v_sent_at constant timestamptz := clock_timestamp();
  v_result jsonb;
  v_session_id uuid;
  v_version bigint;
  v_online_started timestamptz;
  v_refusal text;
begin
  if to_regprocedure(
    'public.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean)'
  ) is not null then raise exception 'the transition without a captured time still has a second overload'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000720',
    p_request_hash => repeat('1', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => v_start_at, p_sent_at => v_sent_at
  );
  v_session_id := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000721',
    p_request_hash => repeat('2', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'break', p_allocation_kind => 'none',
    p_captured_at => v_switch_at, p_sent_at => v_sent_at
  );
  v_version := (v_result->>'version')::bigint;
  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000722',
    p_request_hash => repeat('3', 64), p_action => 'end',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_captured_at => v_end_at, p_sent_at => v_sent_at
  );
  if v_result->>'outcome' <> 'ended'
    or (select started_at from public.time_sessions where id = v_session_id) <> v_start_at
    or (select ended_at from public.time_sessions where id = v_session_id) <> v_end_at
    or (select ended_at from public.time_segments where session_id = v_session_id and kind = 'work') <> v_switch_at
    or (select started_at from public.time_segments where session_id = v_session_id and kind = 'break') <> v_switch_at
    or exists (
      select 1 from public.time_segment_events event
      where event.session_id = v_session_id
        and event.occurred_at not in (v_start_at, v_switch_at, v_end_at)
    )
  then raise exception 'an offline-captured transition was not recorded at its captured time'; end if;
  if (
    select count(*) from public.time_operations operation
    where operation.id in (
      '21000000-0000-0000-0000-000000000720', '21000000-0000-0000-0000-000000000721',
      '21000000-0000-0000-0000-000000000722'
    ) and operation.sent_at = v_sent_at and operation.created_at >= operation.captured_at
  ) <> 3 or (
    select captured_at from public.time_operations where id = '21000000-0000-0000-0000-000000000720'
  ) <> v_start_at
  then raise exception 'an offline-captured operation did not store its captured, sent and receipt times'; end if;

  -- A resend of a recorded operation answers its first result and writes nothing.
  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000722',
    p_request_hash => repeat('3', 64), p_action => 'end',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_captured_at => v_end_at, p_sent_at => clock_timestamp()
  );
  if (v_result->>'replayed')::boolean is not true
    or (select count(*) from public.time_operations where id = '21000000-0000-0000-0000-000000000722') <> 1
    or (select count(*) from public.time_segment_events where operation_id = '21000000-0000-0000-0000-000000000722') <> 2
    or (select count(*) from public.time_sessions where employee_record_id = (
      select id from public.employee_records where organization_id = v_org and user_id = v_field
    )) <> 1
  then raise exception 'an offline replay wrote a second row'; end if;

  -- Each refusal writes nothing: the operation id stays free.
  foreach v_refusal in array array[
    'time_transition_captured_in_future',
    'time_transition_correction_required',
    'time_transition_outside_recording_window',
    'time_transition_captured_out_of_order',
    'time_transition_job_not_assigned',
    'time_transition_action_invalid',
    'time_transition_invalid_input'
  ] loop
    begin
      perform public.transition_time_activity(
        p_organization_id => v_org, p_actor_id => v_field,
        p_operation_id => '21000000-0000-0000-0000-000000000723',
        p_request_hash => repeat('4', 64),
        p_action => case v_refusal
          when 'time_transition_action_invalid' then 'recover_end'
          else 'start' end::public.time_operation_kind,
        p_segment_kind => 'work',
        p_allocation_kind => case v_refusal
          when 'time_transition_job_not_assigned' then 'job'
          else 'unallocated' end::public.time_allocation_kind,
        p_job_id => case v_refusal
          when 'time_transition_job_not_assigned' then '21000000-0000-0000-0000-000000000712'::uuid
          end,
        p_captured_at => case v_refusal
          when 'time_transition_captured_in_future' then clock_timestamp() + interval '10 minutes'
          when 'time_transition_correction_required' then clock_timestamp() - interval '25 hours'
          when 'time_transition_outside_recording_window' then clock_timestamp() - interval '8 days'
          when 'time_transition_captured_out_of_order' then v_end_at - interval '1 minute'
          else clock_timestamp() - interval '1 minute' end,
        p_sent_at => case v_refusal
          when 'time_transition_invalid_input' then null else clock_timestamp() end
      );
      raise exception 'offline refusal % was accepted', v_refusal;
    exception when others then
      if sqlerrm <> v_refusal then raise; end if;
    end;
  end loop;
  if exists (select 1 from public.time_operations where id = '21000000-0000-0000-0000-000000000723')
  then raise exception 'a refused offline transition recorded an operation'; end if;

  -- A replay is a fresh request: a person outside the organization and a
  -- removed member are refused like any other caller.
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000711', p_actor_id => v_field,
      p_operation_id => '21000000-0000-0000-0000-000000000724',
      p_request_hash => repeat('5', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated',
      p_captured_at => clock_timestamp() - interval '1 minute', p_sent_at => clock_timestamp()
    );
    raise exception 'an offline transition into a foreign organization was accepted';
  exception when others then
    if sqlerrm <> 'time_transition_not_authorized' then raise; end if;
  end;
  delete from public.organization_members
  where organization_id = v_org and user_id = '21000000-0000-0000-0000-000000000703';
  begin
    perform public.transition_time_activity(
      p_organization_id => v_org, p_actor_id => '21000000-0000-0000-0000-000000000703',
      p_operation_id => '21000000-0000-0000-0000-000000000725',
      p_request_hash => repeat('6', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated',
      p_captured_at => clock_timestamp() - interval '1 minute', p_sent_at => clock_timestamp()
    );
    raise exception 'an offline transition of a removed member was accepted';
  exception when others then
    if sqlerrm <> 'time_transition_not_authorized' then raise; end if;
  end;

  -- An online call keeps the server clock and stores no captured time.
  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000726',
    p_request_hash => repeat('7', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  select started_at into v_online_started from public.time_sessions
  where id = (v_result->>'sessionId')::uuid;
  if v_online_started < now() or v_online_started > clock_timestamp()
    or (select captured_at from public.time_operations where id = '21000000-0000-0000-0000-000000000726') is not null
    or (select sent_at from public.time_operations where id = '21000000-0000-0000-0000-000000000726') is not null
  then raise exception 'an online transition did not keep the server clock'; end if;
  perform public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000727',
    p_request_hash => repeat('8', 64), p_action => 'end',
    p_expected_session_id => (v_result->>'sessionId')::uuid,
    p_expected_version => (v_result->>'version')::bigint
  );
end;
$$;

-- An offline start onto a job the office blocked meanwhile is refused with
-- the start gate's own error, which field sync answers as a conflict, and
-- writes nothing.
do $$
begin
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000710',
    p_actor_id => '21000000-0000-0000-0000-000000000702',
    p_operation_id => '21000000-0000-0000-0000-000000000728',
    p_request_hash => repeat('1', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'job',
    p_job_id => '21000000-0000-0000-0000-000000000713',
    p_captured_at => clock_timestamp(), p_sent_at => clock_timestamp()
  );
  raise exception 'an offline start onto a blocked job was accepted';
exception when others then
  if sqlerrm <> 'work_transition_start_blocked' then raise; end if;
end;
$$;
do $$
begin
  if exists (select 1 from public.time_operations where id = '21000000-0000-0000-0000-000000000728')
    or exists (
      select 1 from public.time_sessions
      where user_id = '21000000-0000-0000-0000-000000000702' and ended_at is null
    )
  then raise exception 'a refused start onto a blocked job wrote time'; end if;
end;
$$;

-- A device clock that runs ahead, inside the 5 minutes tolerance, records the
-- event at its receipt, never later: an online end right after it still ends
-- the segment after it started. The operation keeps the device's times.
do $$
declare
  v_org constant uuid := '21000000-0000-0000-0000-000000000710';
  v_field constant uuid := '21000000-0000-0000-0000-000000000702';
  v_captured_at constant timestamptz := clock_timestamp() + interval '3 minutes';
  v_sent_at constant timestamptz := clock_timestamp() + interval '3 minutes';
  v_received_after timestamptz := clock_timestamp();
  v_result jsonb;
  v_session public.time_sessions%rowtype;
begin
  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000729',
    p_request_hash => repeat('2', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => v_captured_at, p_sent_at => v_sent_at
  );
  select * into v_session from public.time_sessions where id = (v_result->>'sessionId')::uuid;
  if v_session.started_at < v_received_after or v_session.started_at > clock_timestamp()
    or exists (
      select 1 from public.time_segment_events
      where operation_id = '21000000-0000-0000-0000-000000000729'
        and occurred_at <> v_session.started_at
    )
    or (select started_at from public.time_segments where session_id = v_session.id) <> v_session.started_at
  then raise exception 'an offline event captured ahead of the receipt was not recorded at the receipt'; end if;
  if (select captured_at from public.time_operations where id = '21000000-0000-0000-0000-000000000729')
      <> v_captured_at
    or (select sent_at from public.time_operations where id = '21000000-0000-0000-0000-000000000729')
      <> v_sent_at
  then raise exception 'an offline operation captured ahead did not keep the device times'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => v_org, p_actor_id => v_field,
    p_operation_id => '21000000-0000-0000-0000-000000000730',
    p_request_hash => repeat('3', 64), p_action => 'end',
    p_expected_session_id => v_session.id,
    p_expected_version => v_session.version
  );
  if v_result->>'outcome' <> 'ended'
    or (select ended_at from public.time_sessions where id = v_session.id) < v_session.started_at
  then raise exception 'an online end after an offline start captured ahead failed'; end if;
end;
$$;

-- The order rule reads the person's latest event in every session of every
-- organization: two sessions that start at the same instant, the shorter one
-- sorting first by id, still bound an offline start to the end of the longer
-- one, and time recorded since in another organization bounds it too.
reset role;
do $$
declare
  v_org constant uuid := '21000000-0000-0000-0000-000000000710';
  v_user constant uuid := '21000000-0000-0000-0000-000000000704';
  v_operation constant uuid := '21000000-0000-0000-0000-000000000740';
  v_long constant uuid := '21000000-0000-0000-0000-000000000741';
  v_short constant uuid := '21000000-0000-0000-0000-000000000749';
  v_base constant timestamptz := date_trunc('minute', clock_timestamp() - interval '5 hours');
  v_other_org constant uuid := '21000000-0000-0000-0000-000000000711';
  v_other_session constant uuid := '21000000-0000-0000-0000-000000000743';
  v_employee uuid;
  v_other_employee uuid;
  v_previous_capture_write text := coalesce(current_setting('app.time_capture_write', true), '');
begin
  select id into v_employee from public.employee_records
  where organization_id = v_org and user_id = v_user;
  select id into v_other_employee from public.employee_records
  where organization_id = v_other_org and user_id = v_user;
  perform set_config('app.time_capture_write', 'true', true);
  insert into public.time_operations (
    id, organization_id, employee_record_id, actor_id, operation_kind, request_hash, result_payload
  ) values (v_operation, v_org, v_employee, v_user, 'end', repeat('c', 64), '{}');
  insert into public.time_sessions (
    id, organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) values
    (v_long, v_org, v_employee, v_user, 'closed', v_base, v_base + interval '1 hour', v_user, v_user),
    (v_short, v_org, v_employee, v_user, 'closed', v_base, v_base, v_user, v_user);
  insert into public.time_segment_events (
    organization_id, session_id, operation_id, event_type, source, actor_id, occurred_at
  ) values
    (v_org, v_long, v_operation, 'session_started', 'employee', v_user, v_base),
    (v_org, v_long, v_operation, 'session_ended', 'employee', v_user, v_base + interval '1 hour'),
    (v_org, v_short, v_operation, 'session_started', 'employee', v_user, v_base),
    (v_org, v_short, v_operation, 'session_ended', 'employee', v_user, v_base);
  -- Later the same day the person worked two hours in the other organization.
  insert into public.time_operations (
    id, organization_id, employee_record_id, actor_id, operation_kind, request_hash, result_payload
  ) values (
    '21000000-0000-0000-0000-000000000744', v_other_org, v_other_employee, v_user, 'end',
    repeat('e', 64), '{}'
  );
  insert into public.time_sessions (
    id, organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) values (
    v_other_session, v_other_org, v_other_employee, v_user, 'closed',
    v_base + interval '2 hours', v_base + interval '4 hours', v_user, v_user
  );
  insert into public.time_segment_events (
    organization_id, session_id, operation_id, event_type, source, actor_id, occurred_at
  ) values
    (v_other_org, v_other_session, '21000000-0000-0000-0000-000000000744', 'session_started',
      'employee', v_user, v_base + interval '2 hours'),
    (v_other_org, v_other_session, '21000000-0000-0000-0000-000000000744', 'session_ended',
      'employee', v_user, v_base + interval '4 hours');
  perform set_config('app.time_capture_write', v_previous_capture_write, true);
end;
$$;
set local role service_role;
do $$
begin
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000710',
    p_actor_id => '21000000-0000-0000-0000-000000000704',
    p_operation_id => '21000000-0000-0000-0000-000000000742',
    p_request_hash => repeat('d', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => (
      select started_at + interval '30 minutes' from public.time_sessions
      where id = '21000000-0000-0000-0000-000000000741'
    ),
    p_sent_at => clock_timestamp()
  );
  raise exception 'an offline start inside an equally started longer session was accepted';
exception when others then
  if sqlerrm <> 'time_transition_captured_out_of_order' then raise; end if;
end;
$$;
do $$
begin
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000710',
    p_actor_id => '21000000-0000-0000-0000-000000000704',
    p_operation_id => '21000000-0000-0000-0000-000000000745',
    p_request_hash => repeat('f', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => (
      select started_at + interval '1 hour' from public.time_sessions
      where id = '21000000-0000-0000-0000-000000000743'
    ),
    p_sent_at => clock_timestamp()
  );
  raise exception 'an offline start inside time recorded in another organization was accepted';
exception when others then
  if sqlerrm <> 'time_transition_captured_out_of_order' then raise; end if;
end;
$$;
do $$
begin
  if exists (
    select 1 from public.time_operations
    where id in ('21000000-0000-0000-0000-000000000742', '21000000-0000-0000-0000-000000000745')
  ) or exists (
    select 1 from public.time_sessions session
    join public.employee_records employee on employee.id = session.employee_record_id
    where employee.user_id = '21000000-0000-0000-0000-000000000704'
      and session.id not in (
        '21000000-0000-0000-0000-000000000741', '21000000-0000-0000-0000-000000000749',
        '21000000-0000-0000-0000-000000000743'
      )
  ) then raise exception 'a refused out-of-order start wrote time'; end if;
end;
$$;

-- An offline transition captured on a day of a closed period is refused with
-- the closed-period error, before any window rule. Only an ended month
-- closes, so the captured time lies in last month.
do $$
declare
  v_org constant uuid := '21000000-0000-0000-0000-000000000710';
  v_admin constant uuid := '21000000-0000-0000-0000-000000000701';
  v_month_start constant date :=
    (date_trunc('month', (now() at time zone 'Europe/Berlin')) - interval '1 month')::date;
  v_month_end constant date := (v_month_start + interval '1 month - 1 day')::date;
  v_captured_at constant timestamptz := (v_month_end + time '12:00') at time zone 'Europe/Berlin';
  v_calculation uuid;
begin
  v_calculation := public.prepare_time_period(
    v_admin, v_org, v_month_start, v_month_end,
    app_private.compute_p1_23_source_fingerprint(v_org, v_month_start, v_month_end),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid(), 'employee_record_id', employee.id,
        'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
        'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
        'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
        'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false)), '[]')
      from public.employee_records employee
      where employee.organization_id = v_org
        and coalesce(employee.entry_date, v_month_start) <= v_month_end
        and coalesce(employee.exit_date, v_month_end) >= v_month_start
    ), '[]', '[]', '[]', '21000000-0000-0000-0000-000000000730', repeat('9', 64));
  perform public.close_time_period(
    v_admin, v_org, (select period_id from public.time_period_calculations where id = v_calculation),
    '21000000-0000-0000-0000-000000000731', repeat('a', 64));
  begin
    perform public.transition_time_activity(
      p_organization_id => v_org, p_actor_id => '21000000-0000-0000-0000-000000000702',
      p_operation_id => '21000000-0000-0000-0000-000000000732',
      p_request_hash => repeat('b', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated',
      p_captured_at => v_captured_at, p_sent_at => clock_timestamp()
    );
    raise exception 'an offline transition into a closed period was accepted';
  exception when sqlstate 'WFP01' then
    null;
  end;
end;
$$;

-- The clock never runs on a parked job: a clock-in, a switch and the resume
-- after a break onto a parked job are refused and write nothing.
reset role;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '21000000-0000-0000-0000-000000000068',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-21-parked@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Parked","last_name":"Worker"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values (
  '21000000-0000-0000-0000-000000000060', 'P1-21 Parked',
  '21000000-0000-0000-0000-000000000001', 'P121PRK'
);
insert into public.jobs (id, organization_id, title, job_number, status, created_by)
values
(
  '21000000-0000-0000-0000-000000000061', '21000000-0000-0000-0000-000000000060',
  'P1-21 Geparkt', 'P121-PARK', 'geparkt', '21000000-0000-0000-0000-000000000001'
),
(
  '21000000-0000-0000-0000-000000000062', '21000000-0000-0000-0000-000000000060',
  'P1-21 Offen', 'P121-OPEN', 'nicht_bearbeitet', '21000000-0000-0000-0000-000000000001'
);
insert into public.organization_members (organization_id, user_id, role)
values ('21000000-0000-0000-0000-000000000060', '21000000-0000-0000-0000-000000000068', 'employee');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by)
select '21000000-0000-0000-0000-000000000060', job_id, '21000000-0000-0000-0000-000000000068',
  '21000000-0000-0000-0000-000000000001'
from unnest(array[
  '21000000-0000-0000-0000-000000000061', '21000000-0000-0000-0000-000000000062'
]::uuid[]) job_id;
set local role service_role;
do $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_version bigint;
begin
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000060',
      p_actor_id => '21000000-0000-0000-0000-000000000068',
      p_operation_id => '21000000-0000-0000-0000-000000000063',
      p_request_hash => repeat('a', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'job',
      p_job_id => '21000000-0000-0000-0000-000000000061'
    );
    raise exception 'clock-in on a parked job was accepted';
  exception when others then
    if sqlerrm not like '%time_transition_job_unavailable%' then raise; end if;
  end;
  if exists (
    select 1 from public.time_sessions where organization_id = '21000000-0000-0000-0000-000000000060'
  ) then raise exception 'refused clock-in on a parked job left a session'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000060',
    p_actor_id => '21000000-0000-0000-0000-000000000068',
    p_operation_id => '21000000-0000-0000-0000-000000000064',
    p_request_hash => repeat('b', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'job',
    p_job_id => '21000000-0000-0000-0000-000000000062'
  );
  v_session_id := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000060',
      p_actor_id => '21000000-0000-0000-0000-000000000068',
      p_operation_id => '21000000-0000-0000-0000-000000000065',
      p_request_hash => repeat('c', 64), p_action => 'switch',
      p_expected_session_id => v_session_id, p_expected_version => v_version,
      p_segment_kind => 'work', p_allocation_kind => 'job',
      p_job_id => '21000000-0000-0000-0000-000000000061'
    );
    raise exception 'switch to a parked job was accepted';
  exception when others then
    if sqlerrm not like '%time_transition_job_unavailable%' then raise; end if;
  end;
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000060',
    p_actor_id => '21000000-0000-0000-0000-000000000068',
    p_operation_id => '21000000-0000-0000-0000-000000000066',
    p_request_hash => repeat('d', 64), p_action => 'switch',
    p_expected_session_id => v_session_id, p_expected_version => v_version,
    p_segment_kind => 'break', p_allocation_kind => 'none'
  );
end;
$$;
-- The office parks the job while its worker is on a break.
reset role;
set local session_replication_role = replica;
update public.jobs set status = 'geparkt', execution_state = 'not_started'
where id = '21000000-0000-0000-0000-000000000062';
set local session_replication_role = origin;
set local role service_role;
do $$
declare
  v_session public.time_sessions%rowtype;
begin
  select * into v_session from public.time_sessions
  where organization_id = '21000000-0000-0000-0000-000000000060' and ended_at is null;
  begin
    perform public.transition_time_activity(
      p_organization_id => '21000000-0000-0000-0000-000000000060',
      p_actor_id => '21000000-0000-0000-0000-000000000068',
      p_operation_id => '21000000-0000-0000-0000-000000000067',
      p_request_hash => repeat('e', 64), p_action => 'switch',
      p_expected_session_id => v_session.id, p_expected_version => v_session.version,
      p_segment_kind => 'work', p_allocation_kind => 'job',
      p_job_id => '21000000-0000-0000-0000-000000000062'
    );
    raise exception 'resume onto a parked job was accepted';
  exception when others then
    if sqlerrm not like '%time_transition_job_unavailable%' then raise; end if;
  end;
  if not exists (
    select 1 from public.time_segments
    where session_id = v_session.id and kind = 'break' and ended_at is null
  ) then raise exception 'refused resume onto a parked job ended the break'; end if;
end;
$$;

-- P1-21-F48/F50: members read their organization's canonical time rows;
-- a person outside the organization reads none of them.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
do $$
begin
  if not exists (
    select 1 from public.time_sessions
    where organization_id = '21000000-0000-0000-0000-000000000012'
  ) then raise exception 'organization admin cannot read its own time sessions'; end if;
end;
$$;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
do $$
begin
  if exists (
    select 1 from public.time_sessions
    where organization_id = '21000000-0000-0000-0000-000000000012'
  ) or exists (
    select 1 from public.time_segments
    where organization_id = '21000000-0000-0000-0000-000000000012'
  ) or exists (
    select 1 from public.time_operations
    where organization_id = '21000000-0000-0000-0000-000000000012'
  ) or exists (
    select 1 from public.time_segment_events
    where organization_id = '21000000-0000-0000-0000-000000000012'
  ) then raise exception 'outsider read canonical time rows of another organization'; end if;
end;
$$;
set local role service_role;
delete from public.organizations
where id = '21000000-0000-0000-0000-000000000012';

reset role;
set constraints all immediate;
rollback;
