-- A failed or abandoned payroll export no longer blocks the next one
-- (migration 20261004140300_recover_failed_payroll_exports.sql). A failed
-- successor gives up its claim on the ready export it meant to replace, a
-- generating export that has not changed for 15 minutes fails with the reason
-- generation_abandoned when the period is exported again, and a running
-- export still keeps a second successor out.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26143000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'payroll-recovery-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Payroll"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('26143000-0000-0000-0000-000000000010', 'Payroll recovery SQL',
 '26143000-0000-0000-0000-000000000001', 'PAYRECSQ');

-- Runs one call and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm not like p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

create table pg_temp.export_fixture (period_id uuid, mapping_id uuid, ready_id uuid);
grant select, insert on pg_temp.export_fixture to service_role;

set local role service_role;

-- June closes through the real prepare and close functions, with a mapping
-- and one ready export.
do $$
declare
  v_org constant uuid := '26143000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26143000-0000-0000-0000-000000000001';
  v_record uuid;
  v_calculation uuid;
  v_period uuid;
  v_mapping uuid;
  v_ready uuid;
begin
  select id into v_record from public.employee_records where organization_id = v_org and user_id = v_admin;
  update public.employee_records set entry_date = '2026-06-01' where id = v_record;
  perform public.open_time_account(v_org, v_record, 0, '2026-06-01', 'Test-Eröffnung',
    v_admin, '26143000-0000-0000-0000-000000000020', repeat('a', 64));
  v_calculation := public.prepare_time_period(
    v_admin, v_org, '2026-06-01', '2026-06-30',
    app_private.compute_p1_23_source_fingerprint(v_org, '2026-06-01', '2026-06-30'),
    jsonb_build_array(jsonb_build_object(
      'id', '26143000-0000-0000-0000-000000000021', 'employee_record_id', v_record,
      'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
      'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
      'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
      'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false)),
    '[]', '[]', '[]', '26143000-0000-0000-0000-000000000022', repeat('b', 64));
  select period_id into v_period from public.time_period_calculations where id = v_calculation;
  perform public.close_time_period(v_admin, v_org, v_period, '26143000-0000-0000-0000-000000000023', repeat('c', 64));

  v_mapping := public.create_payroll_mapping_version(v_admin, v_org,
    jsonb_build_array(jsonb_build_object('employee_record_id', v_record, 'external_employee_reference', 'MA-001')),
    (select jsonb_agg(jsonb_build_object('value_kind', value_kind, 'activity_kind', null, 'output_code', upper(value_kind::text)))
       from unnest(enum_range(null::public.payroll_mapping_value_kind)) value_kind
       where value_kind <> 'credited_activity')
    || (select jsonb_agg(jsonb_build_object('value_kind', 'credited_activity', 'activity_kind', activity_kind,
         'output_code', upper(activity_kind::text)))
       from unnest(enum_range(null::public.time_segment_kind)) activity_kind),
    '26143000-0000-0000-0000-000000000024', repeat('d', 64));

  v_ready := public.reserve_payroll_export(v_admin, v_org, v_period, v_mapping, 'p1-23-v1', repeat('e', 64), null,
    '26143000-0000-0000-0000-000000000030', repeat('f', 64));
  insert into public.documents (id, organization_id, storage_path, original_file_name, display_name, size_bytes, uploaded_by)
  values ('26143000-0000-0000-0000-000000000031', v_org, v_org || '/lohnexporte/2026-06-01/ready.zip',
    'Lohnexport.zip', 'Lohnexport.zip', 10, v_admin);
  perform public.finalize_payroll_export(v_admin, v_org, v_ready, '26143000-0000-0000-0000-000000000031',
    repeat('1', 64), 10, '26143000-0000-0000-0000-000000000032');
  insert into pg_temp.export_fixture values (v_period, v_mapping, v_ready);
end;
$$;

-- A successor that failed gives up its claim: the next successor reserves.
do $$
declare
  v_org constant uuid := '26143000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26143000-0000-0000-0000-000000000001';
  v_fixture record;
  v_failed uuid;
  v_running uuid;
begin
  select * into v_fixture from pg_temp.export_fixture;
  v_failed := public.reserve_payroll_export(v_admin, v_org, v_fixture.period_id, v_fixture.mapping_id, 'p1-23-v1',
    repeat('2', 64), v_fixture.ready_id, '26143000-0000-0000-0000-000000000040', repeat('3', 64));
  perform public.fail_payroll_export(v_admin, v_org, v_failed, 'storage_failed',
    '26143000-0000-0000-0000-000000000041');
  v_running := public.reserve_payroll_export(v_admin, v_org, v_fixture.period_id, v_fixture.mapping_id, 'p1-23-v1',
    repeat('4', 64), v_fixture.ready_id, '26143000-0000-0000-0000-000000000042', repeat('5', 64));
  if (select state from public.payroll_exports where id = v_running) <> 'generating' then
    raise exception 'the export after a failed successor was not reserved';
  end if;
end;
$$;

-- A running successor still keeps a second one out.
select pg_temp.expect_refusal('a second successor while one generates', $sql$
  select public.reserve_payroll_export('26143000-0000-0000-0000-000000000001',
    '26143000-0000-0000-0000-000000000010', (select period_id from pg_temp.export_fixture),
    (select mapping_id from pg_temp.export_fixture), 'p1-23-v1', repeat('6', 64),
    (select ready_id from pg_temp.export_fixture), '26143000-0000-0000-0000-000000000043', repeat('7', 64))
$sql$, '%payroll_exports_successor_unique%');

-- The running export stops without a terminal state. 15 minutes later the
-- next export of the period fails it as abandoned and takes its place.
reset role;
alter table public.payroll_exports disable trigger payroll_exports_updated_at;
update public.payroll_exports set updated_at = now() - interval '16 minutes'
where id = (select id from public.payroll_exports where operation_id = '26143000-0000-0000-0000-000000000042');
alter table public.payroll_exports enable trigger payroll_exports_updated_at;
set local role service_role;

do $$
declare
  v_org constant uuid := '26143000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26143000-0000-0000-0000-000000000001';
  v_fixture record;
  v_abandoned public.payroll_exports;
  v_next uuid;
begin
  select * into v_fixture from pg_temp.export_fixture;
  v_next := public.reserve_payroll_export(v_admin, v_org, v_fixture.period_id, v_fixture.mapping_id, 'p1-23-v1',
    repeat('6', 64), v_fixture.ready_id, '26143000-0000-0000-0000-000000000044', repeat('8', 64));
  select * into v_abandoned from public.payroll_exports
  where operation_id = '26143000-0000-0000-0000-000000000042';
  if v_abandoned.state <> 'failed' or v_abandoned.failure_reason <> 'generation_abandoned'
    or not exists (select 1 from public.payroll_export_events where export_id = v_abandoned.id
      and event_type = 'failed' and event_payload->>'failure_reason' = 'generation_abandoned')
    or (select state from public.payroll_exports where id = v_next) <> 'generating'
    or (select state from public.payroll_exports where id = v_fixture.ready_id) <> 'ready'
  then raise exception 'the abandoned export was not failed or the next one not reserved'; end if;
  -- A fresh generating export is never taken for abandoned.
  if (select state from public.payroll_exports where id = v_next) <> 'generating' then
    raise exception 'the fresh export changed state';
  end if;
end;
$$;

do $$
declare
  v_function constant text := 'public.reserve_payroll_export(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text)';
begin
  if not has_function_privilege('service_role', v_function, 'execute')
    or has_function_privilege('authenticated', v_function, 'execute')
    or has_function_privilege('anon', v_function, 'execute')
  then raise exception 'reserve_payroll_export grants changed'; end if;
end;
$$;

rollback;
