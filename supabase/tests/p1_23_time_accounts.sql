begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('23000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-23-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"P123"}', now(), now()),
('23000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-23-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"P123"}', now(), now()),
('23000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-23-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"P123"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code)
values ('23000000-0000-0000-0000-000000000010', 'P1-23 SQL',
  '23000000-0000-0000-0000-000000000001', 'P123SQL');
insert into public.organization_members (organization_id, user_id, role)
values ('23000000-0000-0000-0000-000000000010',
  '23000000-0000-0000-0000-000000000002', 'employee');

set local role service_role;

do $$
declare
  admin_employee_id uuid;
  employee_id uuid;
  admin_account_id uuid;
  employee_account_id uuid;
  source_fingerprint text;
  employee_results jsonb;
  daily_results jsonb;
  v_calculation_id uuid;
  replayed_calculation_id uuid;
  finding_id uuid;
  close_id uuid;
  replayed_close_id uuid;
  mapping_id uuid;
  export_id uuid;
  adjustment_id uuid;
  account_version_after_submit bigint;
  document_id uuid := '23000000-0000-0000-0000-000000000090';
  code_mappings jsonb;
begin
  select id into admin_employee_id from public.employee_records
    where organization_id = '23000000-0000-0000-0000-000000000010'
      and user_id = '23000000-0000-0000-0000-000000000001';
  select id into employee_id from public.employee_records
    where organization_id = '23000000-0000-0000-0000-000000000010'
      and user_id = '23000000-0000-0000-0000-000000000002';
  if admin_employee_id is null or employee_id is null then
    raise exception 'employee record prerequisite missing (admin %, employee %)',
      admin_employee_id, employee_id;
  end if;
  begin
    perform app_private.assert_p1_23_period_open(
      '23000000-0000-0000-0000-000000000010', null
    );
    raise exception 'null effective date was accepted';
  exception when others then
    if sqlerrm not like '%invalid_effective_date%' then raise; end if;
  end;
  update public.employee_records set entry_date = '2026-07-01'
    where id in (admin_employee_id, employee_id);

  admin_account_id := public.open_time_account(
    '23000000-0000-0000-0000-000000000010', admin_employee_id, 0, '2026-07-01',
    'Test-Eröffnung', '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000020', repeat('a', 64));
  employee_account_id := public.open_time_account(
    '23000000-0000-0000-0000-000000000010', employee_id, 15, '2026-07-01',
    'Test-Eröffnung', '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000021', repeat('b', 64));
  if (select current_balance_minutes from public.time_accounts where id = employee_account_id) <> 15
    then raise exception 'opening balance was not materialized'; end if;

  source_fingerprint := app_private.compute_p1_23_source_fingerprint(
    '23000000-0000-0000-0000-000000000010', '2026-07-01', '2026-07-31');
  insert into public.time_entries(
    user_id, organization_id, entry_type, timestamp, is_manual, status
  ) values (
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000010',
    'clock_in', '2026-08-15 08:00:00+02', true, 'approved'
  );
  if source_fingerprint <> app_private.compute_p1_23_source_fingerprint(
    '23000000-0000-0000-0000-000000000010', '2026-07-01', '2026-07-31'
  ) then raise exception 'future activity invalidated an earlier period'; end if;
  insert into public.organization_closure_days(
    id, organization_id, closure_date, label, created_by
  ) values (
    '23000000-0000-0000-0000-000000000029',
    '23000000-0000-0000-0000-000000000010',
    '2026-07-17', 'Betriebsruhe', '23000000-0000-0000-0000-000000000001'
  );
  if source_fingerprint = app_private.compute_p1_23_source_fingerprint(
    '23000000-0000-0000-0000-000000000010', '2026-07-01', '2026-07-31'
  ) then raise exception 'period closure-day change did not invalidate the calculation'; end if;
  delete from public.organization_closure_days
    where id = '23000000-0000-0000-0000-000000000029';
  if source_fingerprint <> app_private.compute_p1_23_source_fingerprint(
    '23000000-0000-0000-0000-000000000010', '2026-07-01', '2026-07-31'
  ) then raise exception 'restored calendar did not restore the period fingerprint'; end if;
  employee_results := jsonb_build_array(
    jsonb_build_object(
      'id', '23000000-0000-0000-0000-000000000030',
      'employee_record_id', admin_employee_id, 'policy_version_id', null,
      'previous_balance_minutes', 0, 'target_minutes', 0, 'source_seconds', 0,
      'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
      'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
      'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0,
      'authoritative_targets', false
    ),
    jsonb_build_object(
      'id', '23000000-0000-0000-0000-000000000031',
      'employee_record_id', employee_id, 'policy_version_id', null,
      'previous_balance_minutes', 0, 'target_minutes', 0, 'source_seconds', 3600,
      'source_minutes', 60, 'credited_minutes', 60, 'vacation_minutes', 0,
      'sickness_minutes', 0, 'account_event_minutes', 15, 'period_delta_minutes', 75,
      'overtime_candidate_minutes', 60, 'closing_balance_minutes', 75,
      'authoritative_targets', false
    )
  );
  daily_results := jsonb_build_array(jsonb_build_object(
    'id', '23000000-0000-0000-0000-000000000040',
    'employee_result_id', '23000000-0000-0000-0000-000000000031',
    'employee_record_id', employee_id, 'local_date', '2026-07-15',
    'activity_kind', 'work', 'travel_route', null, 'travel_role', null,
    'standby_context', null, 'credit_percentage', 100, 'source_seconds', 3600,
    'source_minutes', 60, 'credited_seconds', 3600, 'credited_minutes', 60,
    'rounding_delta_seconds', 0, 'target_minutes', 0, 'vacation_minutes', 0,
    'sickness_minutes', 0, 'night_minutes', 0, 'sunday_minutes', 0,
    'public_holiday_minutes', 0
  ));

  v_calculation_id := public.prepare_time_period(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    '2026-07-01', '2026-07-31', source_fingerprint, employee_results, daily_results, '[]',
    jsonb_build_array(jsonb_build_object(
      'employee_record_id', employee_id, 'local_date', null,
      'finding_kind', 'positive_overtime', 'severity', 'approval_required',
      'source_fingerprint', repeat('c', 64), 'explanation', '{"minutes":60}'::jsonb
    )), '23000000-0000-0000-0000-000000000050', repeat('d', 64));
  replayed_calculation_id := public.prepare_time_period(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    '2026-07-01', '2026-07-31', source_fingerprint, employee_results, daily_results, '[]', '[]',
    '23000000-0000-0000-0000-000000000050', repeat('d', 64));
  if v_calculation_id <> replayed_calculation_id then raise exception 'prepare replay changed identity'; end if;

  begin
    perform public.prepare_time_period(
      '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
      '2026-07-01', '2026-07-31', source_fingerprint,
      jsonb_build_array(employee_results->0), '[]', '[]', '[]',
      '23000000-0000-0000-0000-000000000051', repeat('e', 64));
    raise exception 'incomplete workforce was accepted';
  exception when others then
    if sqlerrm not like '%incomplete_period_population%' then raise; end if;
  end;

  select finding.id into finding_id from public.time_period_findings finding
    where finding.calculation_id = v_calculation_id;
  begin
    perform public.close_time_period(
      '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
      (select period_id from public.time_period_calculations where id = v_calculation_id),
      '23000000-0000-0000-0000-000000000052', repeat('f', 64));
    raise exception 'unapproved overtime was closed';
  exception when others then
    if sqlerrm not like '%approval_required_finding%' then raise; end if;
  end;
  perform public.decide_time_period_finding(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    finding_id, 'approved', 'Geprüft', '23000000-0000-0000-0000-000000000053');
  close_id := public.close_time_period(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    (select period_id from public.time_period_calculations where id = v_calculation_id),
    '23000000-0000-0000-0000-000000000054', repeat('1', 64));
  replayed_close_id := public.close_time_period(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    (select period_id from public.time_period_calculations where id = v_calculation_id),
    '23000000-0000-0000-0000-000000000054', repeat('1', 64));
  if close_id <> replayed_close_id then raise exception 'close replay changed identity'; end if;
  if (select current_balance_minutes from public.time_accounts where id = employee_account_id) <> 75
    then raise exception 'materialized employee balance is wrong'; end if;
  begin
    perform app_private.assert_p1_23_period_open(
      '23000000-0000-0000-0000-000000000010', '2026-07-15');
    raise exception 'closed effective date was accepted';
  exception when others then
    if sqlerrm not like '%period_closed%' then raise; end if;
  end;
  begin
    update public.time_period_close_versions set source_fingerprint = repeat('2', 64) where id = close_id;
    raise exception 'immutable close version was updated';
  exception when others then
    if sqlerrm not like '%p1_23_history_immutable%' then raise; end if;
  end;

  code_mappings := jsonb_build_array(
    jsonb_build_object('value_kind','target','activity_kind',null,'output_code','SOLL'),
    jsonb_build_object('value_kind','source_attendance','activity_kind',null,'output_code','ANWESEND'),
    jsonb_build_object('value_kind','effective_attendance','activity_kind',null,'output_code','EFFEKTIV'),
    jsonb_build_object('value_kind','vacation','activity_kind',null,'output_code','URLAUB'),
    jsonb_build_object('value_kind','sickness','activity_kind',null,'output_code','KRANK'),
    jsonb_build_object('value_kind','overtime','activity_kind',null,'output_code','MEHRARBEIT'),
    jsonb_build_object('value_kind','night_supplement','activity_kind',null,'output_code','NACHT'),
    jsonb_build_object('value_kind','sunday_supplement','activity_kind',null,'output_code','SONNTAG'),
    jsonb_build_object('value_kind','public_holiday_supplement','activity_kind',null,'output_code','FEIERTAG'),
    jsonb_build_object('value_kind','manual_adjustment','activity_kind',null,'output_code','KORREKTUR'),
    jsonb_build_object('value_kind','expiry','activity_kind',null,'output_code','VERFALL'),
    jsonb_build_object('value_kind','payout','activity_kind',null,'output_code','AUSZAHLUNG'),
    jsonb_build_object('value_kind','opening_balance','activity_kind',null,'output_code','START'),
    jsonb_build_object('value_kind','closing_balance','activity_kind',null,'output_code','SALDO'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','work','output_code','ARBEIT'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','travel','output_code','FAHRT'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','break','output_code','PAUSE'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','internal_activity','output_code','INTERN'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','standby','output_code','BEREITSCHAFT'),
    jsonb_build_object('value_kind','credited_activity','activity_kind','callout','output_code','EINSATZ')
  );
  mapping_id := public.create_payroll_mapping_version(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    jsonb_build_array(
      jsonb_build_object('employee_record_id', admin_employee_id, 'external_employee_reference', 'MA-001'),
      jsonb_build_object('employee_record_id', employee_id, 'external_employee_reference', 'MA-002')
    ), code_mappings, '23000000-0000-0000-0000-000000000060', repeat('3', 64));
  export_id := public.reserve_payroll_export(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    (select period_id from public.time_period_calculations where id = v_calculation_id), mapping_id,
    'p1-23-v1', repeat('4', 64), null,
    '23000000-0000-0000-0000-000000000061', repeat('5', 64));
  insert into public.documents (
    id, organization_id, storage_path, original_file_name, display_name,
    mime_type, size_bytes, uploaded_by, metadata
  ) values (document_id, '23000000-0000-0000-0000-000000000010',
    '23000000-0000-0000-0000-000000000010/p1-23/test.zip', 'test.zip', 'Testexport', 'application/zip', 123,
    '23000000-0000-0000-0000-000000000001', '{"kind":"payroll_export"}');
  perform public.finalize_payroll_export(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    export_id, document_id, repeat('6', 64), 123,
    '23000000-0000-0000-0000-000000000062');
  if (select state from public.payroll_exports where id = export_id) <> 'ready'
    then raise exception 'export was not finalized'; end if;

  perform public.reopen_time_period(
    '23000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000010',
    (select period_id from public.time_period_calculations where id = v_calculation_id),
    'Korrektur erforderlich', '23000000-0000-0000-0000-000000000070', repeat('7', 64));
  if (select current_balance_minutes from public.time_accounts where id = employee_account_id) <> 15
    then raise exception 'reopen did not reverse the closed balance'; end if;
  perform app_private.assert_p1_23_period_open(
    '23000000-0000-0000-0000-000000000010', '2026-07-15');

  adjustment_id := public.submit_time_account_adjustment(
    '23000000-0000-0000-0000-000000000010', employee_account_id,
    (select version from public.time_accounts where id = employee_account_id),
    'manual_adjustment', 30, '2026-07-15', 'Abgelehnter Test',
    '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000071', repeat('8', 64)
  );
  select version into account_version_after_submit
  from public.time_accounts where id = employee_account_id;
  perform public.decide_time_account_adjustment(
    '23000000-0000-0000-0000-000000000010', adjustment_id, 1,
    'rejected', 'Nicht übernehmen',
    '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000072'
  );
  if (select current_balance_minutes from public.time_accounts where id = employee_account_id) <> 15
     or (select version from public.time_accounts where id = employee_account_id) <> account_version_after_submit
    then raise exception 'rejected adjustment mutated the account root'; end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000002',
  true
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_periods_closed_requires_close_version'
      and conrelid = 'public.time_periods'::regclass
  ) then
    raise exception 'closed periods can lose their close version';
  end if;
  if (select count(*) from public.time_period_employee_results) <> 1
    then raise exception 'employee result visibility was not limited to own row'; end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000003',
  true
);

do $$
begin
  if (select count(*) from public.time_periods
      where organization_id = '23000000-0000-0000-0000-000000000010') <> 0
    then raise exception 'outsider could read time periods'; end if;
  if has_function_privilege('authenticated',
      'public.prepare_time_period(uuid,uuid,date,date,text,jsonb,jsonb,jsonb,jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.prepare_time_period(uuid,uuid,date,date,text,jsonb,jsonb,jsonb,jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.close_time_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.close_time_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.reopen_time_period(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.reopen_time_period(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE')
    then raise exception 'application role retained P1-23 mutation RPC execution'; end if;
  if has_function_privilege('service_role',
      'public.prepare_time_period_p1_23_base(uuid,uuid,date,date,text,jsonb,jsonb,jsonb,jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role',
      'public.close_time_period_p1_23_base(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role',
      'public.reopen_time_period_p1_23_base(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE')
    then raise exception 'service role can bypass P1-23 authorization wrappers'; end if;
end;
$$;

rollback;
