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
    'public.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean)'
  ) is null or to_regprocedure(
    'app_private.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean)'
  ) is null then raise exception 'serialized transition wrapper is incomplete'; end if;
  if pg_get_functiondef(to_regprocedure(
    'public.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean)'
  )) not like '%pg_advisory_xact_lock%'
  then raise exception 'serialized transition lock is missing'; end if;
  if has_function_privilege(
    'service_role',
    'app_private.transition_time_activity(uuid,uuid,uuid,text,time_operation_kind,uuid,bigint,time_segment_kind,time_allocation_kind,uuid,planning_internal_type,time_travel_route,time_travel_role,time_standby_context,boolean)',
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
  perform public.transition_time_activity(
    p_organization_id => '21000000-0000-0000-0000-000000000002',
    p_actor_id => '21000000-0000-0000-0000-000000000001',
    p_operation_id => '21000000-0000-0000-0000-000000000021',
    p_request_hash => repeat('f', 64), p_action => 'end',
    p_expected_session_id => v_session_id, p_expected_version => v_version
  );

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

reset role;
set constraints all immediate;
rollback;
