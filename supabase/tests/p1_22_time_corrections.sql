begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '22000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-22-admin@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Admin","last_name":"P122"}'::jsonb, now(), now()
),
(
  '22000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-22-buero@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Buero","last_name":"P122"}'::jsonb, now(), now()
),
(
  '22000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-22-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Employee","last_name":"P122"}'::jsonb, now(), now()
),
(
  '22000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p1-22-outsider@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Outside","last_name":"P122"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '22000000-0000-0000-0000-000000000010', 'P1-22 SQL',
  '22000000-0000-0000-0000-000000000001', 'P122SQL'
);
insert into public.organization_members (organization_id, user_id, role)
values
(
  '22000000-0000-0000-0000-000000000010',
  '22000000-0000-0000-0000-000000000002', 'buero'
),
(
  '22000000-0000-0000-0000-000000000010',
  '22000000-0000-0000-0000-000000000003', 'employee'
);

insert into public.time_entries (
  id, user_id, organization_id, entry_type, timestamp, is_manual, status
) values (
  '22000000-0000-0000-0000-000000000020',
  '22000000-0000-0000-0000-000000000003',
  '22000000-0000-0000-0000-000000000010',
  'clock_in', '2026-09-01T06:00:00Z', true, 'approved'
);

set local role service_role;

do $$
declare
  v_employee_record_id uuid;
  v_admin_employee_record_id uuid;
  v_source_version text;
  v_request_id uuid;
  v_duplicate_request_id uuid;
  v_request_two_id uuid;
  v_request_three_id uuid;
  v_direct_request_id uuid;
  v_result jsonb;
  v_before jsonb := '{"schemaVersion":1,"facts":[{"kind":"legacy_transition","timestamp":"2026-09-01T06:00:00Z"}]}'::jsonb;
  v_proposed jsonb := '{"schemaVersion":1,"facts":[]}'::jsonb;
begin
  select id into v_employee_record_id from public.employee_records
  where organization_id = '22000000-0000-0000-0000-000000000010'
    and user_id = '22000000-0000-0000-0000-000000000003';
  select id into v_admin_employee_record_id from public.employee_records
  where organization_id = '22000000-0000-0000-0000-000000000010'
    and user_id = '22000000-0000-0000-0000-000000000001';
  perform set_config('TimeZone', 'UTC', true);
  select updated_at::text into v_source_version from public.time_entries
  where id = '22000000-0000-0000-0000-000000000020';
  perform set_config('TimeZone', 'Europe/Berlin', true);

  v_result := public.create_time_correction_request(
    p_organization_id => '22000000-0000-0000-0000-000000000010',
    p_subject_employee_record_id => v_employee_record_id,
    p_actor_id => '22000000-0000-0000-0000-000000000003',
    p_operation_id => '22000000-0000-0000-0000-000000000030',
    p_kind => 'delete', p_reason => 'Doppelter Eintrag',
    p_source_scope_key => repeat('a', 64),
    p_source_fingerprint => repeat('b', 64),
    p_before_snapshot => v_before, p_proposed_snapshot => v_proposed,
    p_sources => jsonb_build_array(jsonb_build_object(
      'kind', 'legacy_entry', 'id', '22000000-0000-0000-0000-000000000020',
      'version', v_source_version
    ))
  );
  v_request_id := (v_result->>'requestId')::uuid;
  if v_result->>'status' <> 'submitted' then
    raise exception 'employee correction was not submitted';
  end if;
  if (select status from public.time_entries where id = '22000000-0000-0000-0000-000000000020') <> 'approved'
  then raise exception 'pending proposal mutated its source'; end if;

  v_result := public.create_time_correction_request(
    p_organization_id => '22000000-0000-0000-0000-000000000010',
    p_subject_employee_record_id => v_employee_record_id,
    p_actor_id => '22000000-0000-0000-0000-000000000003',
    p_operation_id => '22000000-0000-0000-0000-000000000030',
    p_kind => 'delete', p_reason => 'Doppelter Eintrag',
    p_source_scope_key => repeat('a', 64),
    p_source_fingerprint => repeat('b', 64),
    p_before_snapshot => v_before, p_proposed_snapshot => v_proposed,
    p_sources => jsonb_build_array(jsonb_build_object(
      'kind', 'legacy_entry', 'id', '22000000-0000-0000-0000-000000000020',
      'version', v_source_version
    ))
  );
  if (v_result->>'replayed')::boolean is not true
    or (v_result->>'requestId')::uuid <> v_request_id
  then raise exception 'submission replay failed'; end if;

  begin
    perform public.decide_time_correction(
      v_request_id, '22000000-0000-0000-0000-000000000003',
      '22000000-0000-0000-0000-000000000031', 1, 'approve', null, '{}'
    );
    raise exception 'self approval was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_self_approval_forbidden%' then raise; end if;
  end;

  perform public.decide_time_correction(
    v_request_id, '22000000-0000-0000-0000-000000000001',
    '22000000-0000-0000-0000-000000000032', 1, 'clarify',
    'Bitte den Grund genauer beschreiben.', '{}'
  );
  if (select count(*) from public.time_correction_request_revisions where request_id = v_request_id) <> 1
  then raise exception 'clarification changed immutable revision'; end if;

  v_result := public.revise_time_correction_request(
    v_request_id, '22000000-0000-0000-0000-000000000003',
    '22000000-0000-0000-0000-000000000033', 1,
    'Eintrag wurde versehentlich doppelt erfasst.', repeat('a', 64), repeat('b', 64),
    v_before, v_proposed, jsonb_build_array(jsonb_build_object(
      'kind', 'legacy_entry', 'id', '22000000-0000-0000-0000-000000000020',
      'version', v_source_version
    ))
  );
  if (v_result->>'revision')::bigint <> 2
    or (select count(*) from public.time_correction_request_revisions where request_id = v_request_id) <> 2
  then raise exception 'clarification revision was not appended'; end if;

  perform public.decide_time_correction(
    v_request_id, '22000000-0000-0000-0000-000000000001',
    '22000000-0000-0000-0000-000000000034', 2, 'approve', null,
    '{"mode":"role_default","role":"admin"}'
  );
  if not exists (
    select 1 from public.time_correction_applications where request_id = v_request_id
  ) then raise exception 'approved snapshot was not applied'; end if;

  v_result := public.create_time_correction_request(
    p_organization_id => '22000000-0000-0000-0000-000000000010',
    p_subject_employee_record_id => v_employee_record_id,
    p_actor_id => '22000000-0000-0000-0000-000000000003',
    p_operation_id => '22000000-0000-0000-0000-000000000046',
    p_kind => 'delete', p_reason => 'Dieselbe Quelle erneut',
    p_source_scope_key => repeat('a', 63) || '1',
    p_source_fingerprint => repeat('b', 63) || '1',
    p_before_snapshot => v_before, p_proposed_snapshot => v_proposed,
    p_sources => jsonb_build_array(jsonb_build_object(
      'kind', 'legacy_entry', 'id', '22000000-0000-0000-0000-000000000020',
      'version', v_source_version
    ))
  );
  v_duplicate_request_id := (v_result->>'requestId')::uuid;
  begin
    perform public.decide_time_correction(
      v_duplicate_request_id, '22000000-0000-0000-0000-000000000001',
      '22000000-0000-0000-0000-000000000047', 1, 'approve', null, '{}'
    );
    raise exception 'the same source was applied twice';
  exception when others then
    if sqlerrm not like '%time_correction_source_already_applied%' then raise; end if;
  end;
  if not exists (
    select 1 from public.time_correction_requests
    where id = v_duplicate_request_id and status = 'submitted'
  ) or exists (
    select 1 from public.time_correction_applications
    where request_id = v_duplicate_request_id
  ) then raise exception 'failed duplicate application changed request state'; end if;

  begin
    update public.time_correction_events set comment = 'changed'
    where request_id = v_request_id;
    raise exception 'history update was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_history_immutable%' then raise; end if;
  end;

  v_result := public.create_time_correction_request(
    '22000000-0000-0000-0000-000000000010', v_employee_record_id,
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000035', 'add', 'Nachtrag durch Büro',
    repeat('c', 64), repeat('d', 64),
    '{"schemaVersion":1,"facts":[]}',
    jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
      jsonb_build_object(
        'factId', 'direct', 'employeeRecordId', v_employee_record_id,
        'userId', '22000000-0000-0000-0000-000000000003',
        'entryType', 'clock_in', 'timestamp', '2026-09-01T14:00:00Z',
        'jobId', null, 'activityKind', null, 'isManual', true
      )
    )),
    '[]', '{"mode":"role_default","role":"buero"}'
  );
  v_direct_request_id := (v_result->>'requestId')::uuid;
  if v_result->>'status' <> 'approved' or not exists (
    select 1 from public.time_correction_applications where request_id = v_direct_request_id
  ) then raise exception 'authorized correction for another subject was not atomic'; end if;

  begin
    perform public.create_time_correction_request(
      '22000000-0000-0000-0000-000000000010', v_employee_record_id,
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000042', 'add', 'Unzulässige Umbuchung',
      repeat('5', 64), repeat('6', 64),
      '{"schemaVersion":1,"facts":[]}',
      jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
        jsonb_build_object(
          'factId', 'target', 'employeeRecordId', v_admin_employee_record_id,
          'userId', '22000000-0000-0000-0000-000000000001',
          'entryType', 'clock_in', 'timestamp', '2026-09-01T15:00:00Z',
          'jobId', null, 'activityKind', null, 'isManual', true
        )
      )), '[]', '{"mode":"role_default","role":"buero"}'
    );
    raise exception 'out-of-scope reassignment was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_reassignment_not_responsible%' then raise; end if;
  end;

  v_result := public.create_time_correction_request(
    '22000000-0000-0000-0000-000000000010', v_employee_record_id,
    '22000000-0000-0000-0000-000000000003',
    '22000000-0000-0000-0000-000000000036', 'add', 'Erster Nachtrag',
    repeat('e', 64), repeat('f', 64),
    '{"schemaVersion":1,"facts":[]}', '{"schemaVersion":1,"facts":[]}',
    '[]', '{}'
  );
  v_request_two_id := (v_result->>'requestId')::uuid;
  v_result := public.create_time_correction_request(
    '22000000-0000-0000-0000-000000000010', v_employee_record_id,
    '22000000-0000-0000-0000-000000000003',
    '22000000-0000-0000-0000-000000000037', 'add', 'Zweiter Nachtrag',
    repeat('1', 64), repeat('2', 64),
    '{"schemaVersion":1,"facts":[]}', '{"schemaVersion":1,"facts":[]}',
    '[]', '{}'
  );
  v_request_three_id := (v_result->>'requestId')::uuid;
  begin
    perform public.create_time_correction_request(
      '22000000-0000-0000-0000-000000000010', v_employee_record_id,
      '22000000-0000-0000-0000-000000000003',
      '22000000-0000-0000-0000-000000000045', 'add', 'Null-Quelle',
      repeat('9', 64), repeat('0', 64),
      '{"schemaVersion":1,"facts":[]}', '{"schemaVersion":1,"facts":[]}',
      null, '{}'
    );
    raise exception 'null source array was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_invalid_input%' then raise; end if;
  end;
  begin
    insert into public.time_correction_applications (
      organization_id, request_id, revision, applied_by, operation_id,
      source_fingerprint, before_snapshot, applied_snapshot,
      responsibility_snapshot
    ) values (
      '22000000-0000-0000-0000-000000000010', v_request_three_id, 1,
      '22000000-0000-0000-0000-000000000001',
      '22000000-0000-0000-0000-000000000043', repeat('7', 64),
      '{"schemaVersion":1,"facts":[]}',
      jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
        jsonb_build_object(
          'factId', 'missing-user', 'employeeRecordId', v_employee_record_id,
          'userId', null, 'entryType', 'clock_in',
          'timestamp', '2026-09-01T16:00:00Z', 'jobId', null,
          'activityKind', null, 'isManual', true
        )
      )), '{}'
    );
    raise exception 'application with a missing target user was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_target_invalid%' then raise; end if;
  end;
  begin
    insert into public.time_correction_applications (
      organization_id, request_id, revision, applied_by, operation_id,
      source_fingerprint, before_snapshot, applied_snapshot,
      responsibility_snapshot
    ) values (
      '22000000-0000-0000-0000-000000000010', v_request_two_id, 1,
      '22000000-0000-0000-0000-000000000001',
      '22000000-0000-0000-0000-000000000044', repeat('8', 64),
      '{"schemaVersion":1,"facts":[]}',
      '{"schemaVersion":1,"facts":{}}', '{}'
    );
    raise exception 'application with non-array facts was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_target_invalid%' then raise; end if;
  end;
  begin
    perform public.decide_time_correction_batch(
      array[v_request_two_id, v_request_three_id],
      '22000000-0000-0000-0000-000000000001',
      array[
        '22000000-0000-0000-0000-000000000038'::uuid,
        '22000000-0000-0000-0000-000000000039'::uuid
      ], array[1::bigint, 9::bigint], 'approve', null, '{}'
    );
    raise exception 'stale batch was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_stale_revision%' then raise; end if;
  end;
  if exists (
    select 1 from public.time_correction_requests
    where id in (v_request_two_id, v_request_three_id) and status <> 'submitted'
  ) then raise exception 'failed batch was partially applied'; end if;

  perform public.withdraw_time_correction(
    v_request_two_id, '22000000-0000-0000-0000-000000000003',
    '22000000-0000-0000-0000-000000000040'
  );
  v_result := public.withdraw_time_correction(
    v_request_two_id, '22000000-0000-0000-0000-000000000003',
    '22000000-0000-0000-0000-000000000040'
  );
  if (v_result->>'replayed')::boolean is not true
  then raise exception 'withdrawal replay failed'; end if;
  begin
    perform public.withdraw_time_correction(
      v_request_three_id, '22000000-0000-0000-0000-000000000003',
      '22000000-0000-0000-0000-000000000040'
    );
    raise exception 'withdrawal operation was replayed across requests';
  exception when others then
    if sqlerrm not like '%time_correction_idempotency_conflict%' then raise; end if;
  end;
  if not exists (
    select 1 from public.time_correction_requests
    where id = v_request_two_id and status = 'withdrawn'
  ) then raise exception 'withdrawal deleted its request'; end if;

  begin
    perform public.create_time_correction_request(
      '22000000-0000-0000-0000-000000000010', v_employee_record_id,
      '22000000-0000-0000-0000-000000000004',
      '22000000-0000-0000-0000-000000000041', 'add', 'Fremder Nachtrag',
      repeat('3', 64), repeat('4', 64),
      '{"schemaVersion":1,"facts":[]}', '{"schemaVersion":1,"facts":[]}',
      '[]', '{}'
    );
    raise exception 'non-member request was accepted';
  exception when others then
    if sqlerrm not like '%time_correction_not_a_member%' then raise; end if;
  end;
end;
$$;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.create_time_correction_request(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then raise exception 'authenticated can execute create RPC'; end if;
  if not has_function_privilege(
    'service_role',
    'public.decide_time_correction(uuid,uuid,uuid,bigint,text,text,jsonb)',
    'EXECUTE'
  ) then raise exception 'service role cannot execute decision RPC'; end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'time_correction_request_revisions'
  ) then raise exception 'immutable revision table was published'; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'time_correction_requests'
  ) then raise exception 'request root was not published'; end if;
end;
$$;

delete from public.organizations
where id = '22000000-0000-0000-0000-000000000010';

do $$
begin
  if exists (
    select 1
    from public.time_correction_requests
    where organization_id = '22000000-0000-0000-0000-000000000010'
  ) then raise exception 'organization teardown retained correction requests'; end if;
  if exists (
    select 1
    from public.time_correction_applications
    where organization_id = '22000000-0000-0000-0000-000000000010'
  ) then raise exception 'organization teardown retained correction applications'; end if;
end;
$$;

rollback;
