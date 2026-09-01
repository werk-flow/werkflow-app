-- P1-23 transactional boundaries for period preparation, close/reopen,
-- payroll mapping versions, and durable export generation.

create or replace function public.prepare_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_start_date date,
  p_period_end_date date,
  p_source_fingerprint text,
  p_employee_results jsonb,
  p_daily_results jsonb,
  p_sources jsonb,
  p_findings jsonb,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  calculation_id uuid := gen_random_uuid();
  calculation_version integer;
  prior_calculation_id uuid;
  current_fingerprint text;
  supplied_employee_count integer;
  expected_employee_count integer;
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_source_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_fingerprint';
  end if;
  if p_period_start_date <> date_trunc('month', p_period_start_date)::date
     or p_period_end_date <> (date_trunc('month', p_period_start_date) + interval '1 month - 1 day')::date then
    raise exception 'invalid_period_boundary';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_start_date::text, 0));
  select event.calculation_id into prior_calculation_id
  from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (
      select 1 from public.time_period_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash
    ) then raise exception 'operation_id_conflict'; end if;
    return prior_calculation_id;
  end if;

  current_fingerprint := app_private.compute_p1_23_source_fingerprint(p_organization_id);
  if current_fingerprint <> p_source_fingerprint then raise exception 'stale_source_fingerprint'; end if;

  select count(*) into expected_employee_count
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and coalesce(employee.entry_date, p_period_start_date) <= p_period_end_date
    and coalesce(employee.exit_date, p_period_end_date) >= p_period_start_date;
  select count(distinct value->>'employee_record_id') into supplied_employee_count
  from jsonb_array_elements(p_employee_results);
  if supplied_employee_count <> expected_employee_count
     or jsonb_array_length(p_employee_results) <> expected_employee_count then
    raise exception 'incomplete_period_population: expected %, supplied %, rows %',
      expected_employee_count, supplied_employee_count, jsonb_array_length(p_employee_results);
  end if;

  insert into public.time_periods (
    organization_id, period_start_date, period_end_date, prepared_by
  ) values (p_organization_id, p_period_start_date, p_period_end_date, p_actor_id)
  on conflict (organization_id, period_start_date, period_end_date) do nothing;

  select * into period_record from public.time_periods
  where organization_id = p_organization_id and period_start_date = p_period_start_date
    and period_end_date = p_period_end_date for update;
  if period_record.state = 'closed' then raise exception 'period_closed'; end if;

  select coalesce(max(version), 0) + 1 into calculation_version
  from public.time_period_calculations where period_id = period_record.id;

  insert into public.time_period_calculations (
    id, organization_id, period_id, version, source_fingerprint,
    target_minutes, source_seconds, credited_minutes, absence_minutes,
    overtime_minutes, account_event_minutes, generated_by
  )
  select calculation_id, p_organization_id, period_record.id, calculation_version, p_source_fingerprint,
    coalesce(sum((value->>'target_minutes')::bigint), 0),
    coalesce(sum((value->>'source_seconds')::numeric), 0),
    coalesce(sum((value->>'credited_minutes')::bigint), 0),
    coalesce(sum((value->>'vacation_minutes')::bigint + (value->>'sickness_minutes')::bigint), 0),
    coalesce(sum((value->>'overtime_candidate_minutes')::bigint), 0),
    coalesce(sum((value->>'account_event_minutes')::bigint), 0), p_actor_id
  from jsonb_array_elements(p_employee_results);

  insert into public.time_period_employee_results (
    id, organization_id, calculation_id, employee_record_id, policy_version_id,
    previous_balance_minutes, target_minutes, source_seconds, source_minutes,
    credited_minutes, vacation_minutes, sickness_minutes, account_event_minutes,
    period_delta_minutes, overtime_candidate_minutes, closing_balance_minutes,
    authoritative_targets
  )
  select (value->>'id')::uuid, p_organization_id, calculation_id,
    (value->>'employee_record_id')::uuid, nullif(value->>'policy_version_id', '')::uuid,
    (value->>'previous_balance_minutes')::integer, (value->>'target_minutes')::integer,
    (value->>'source_seconds')::numeric, (value->>'source_minutes')::integer,
    (value->>'credited_minutes')::integer, (value->>'vacation_minutes')::integer,
    (value->>'sickness_minutes')::integer, (value->>'account_event_minutes')::integer,
    (value->>'period_delta_minutes')::integer, (value->>'overtime_candidate_minutes')::integer,
    (value->>'closing_balance_minutes')::integer, (value->>'authoritative_targets')::boolean
  from jsonb_array_elements(p_employee_results);

  insert into public.time_period_daily_results (
    id, organization_id, employee_result_id, employee_record_id, local_date,
    activity_kind, travel_route, travel_role, standby_context, credit_percentage,
    source_seconds, source_minutes, credited_seconds, credited_minutes,
    rounding_delta_seconds, target_minutes, vacation_minutes, sickness_minutes,
    night_minutes, sunday_minutes, public_holiday_minutes
  )
  select (value->>'id')::uuid, p_organization_id, (value->>'employee_result_id')::uuid,
    (value->>'employee_record_id')::uuid, (value->>'local_date')::date,
    (value->>'activity_kind')::public.time_segment_kind,
    nullif(value->>'travel_route', '')::public.time_travel_route,
    nullif(value->>'travel_role', '')::public.time_travel_role,
    nullif(value->>'standby_context', '')::public.time_standby_context,
    (value->>'credit_percentage')::smallint, (value->>'source_seconds')::numeric,
    (value->>'source_minutes')::integer, (value->>'credited_seconds')::numeric,
    (value->>'credited_minutes')::integer, (value->>'rounding_delta_seconds')::numeric,
    coalesce((value->>'target_minutes')::integer, 0),
    coalesce((value->>'vacation_minutes')::integer, 0),
    coalesce((value->>'sickness_minutes')::integer, 0),
    coalesce((value->>'night_minutes')::integer, 0),
    coalesce((value->>'sunday_minutes')::integer, 0),
    coalesce((value->>'public_holiday_minutes')::integer, 0)
  from jsonb_array_elements(p_daily_results);

  insert into public.time_period_result_sources (
    organization_id, employee_result_id, daily_result_id, source_kind,
    source_id, source_key, source_fingerprint, source_snapshot
  )
  select p_organization_id, (value->>'employee_result_id')::uuid,
    nullif(value->>'daily_result_id', '')::uuid, value->>'source_kind',
    nullif(value->>'source_id', '')::uuid, nullif(value->>'source_key', ''),
    value->>'source_fingerprint', coalesce(value->'source_snapshot', '{}'::jsonb)
  from jsonb_array_elements(p_sources);

  insert into public.time_period_findings (
    organization_id, calculation_id, employee_record_id, local_date,
    finding_kind, severity, source_fingerprint, explanation
  )
  select p_organization_id, calculation_id, nullif(value->>'employee_record_id', '')::uuid,
    nullif(value->>'local_date', '')::date,
    (value->>'finding_kind')::public.time_period_finding_kind,
    (value->>'severity')::public.time_finding_severity,
    value->>'source_fingerprint', coalesce(value->'explanation', '{}'::jsonb)
  from jsonb_array_elements(p_findings);

  update public.time_periods set current_calculation_id = calculation_id,
    state = case when state = 'reopened' then 'reopened'::public.time_period_state else 'prepared'::public.time_period_state end,
    version = version + 1, updated_at = now()
  where id = period_record.id;
  insert into public.time_period_events (
    organization_id, period_id, event_type, calculation_id, operation_id,
    request_hash, actor_id, event_payload
  ) values (
    p_organization_id, period_record.id,
    case when calculation_version = 1 then 'prepared' else 'recalculated' end,
    calculation_id, p_operation_id, p_request_hash, p_actor_id,
    jsonb_build_object('calculation_version', calculation_version, 'source_fingerprint', p_source_fingerprint)
  );
  return calculation_id;
end;
$$;

create or replace function public.decide_time_period_finding(
  p_actor_id uuid, p_organization_id uuid, p_finding_id uuid,
  p_decision public.time_period_finding_decision, p_reason text, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare finding_record public.time_period_findings%rowtype; decision_id uuid;
begin
  select * into finding_record from public.time_period_findings
  where id = p_finding_id and organization_id = p_organization_id;
  if not found then raise exception 'finding_not_found'; end if;
  if finding_record.employee_record_id is not null
     and not app_private.can_p1_23_approve_employee(p_organization_id, p_actor_id, finding_record.employee_record_id) then
    raise exception 'forbidden';
  elsif finding_record.employee_record_id is null
     and not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select id into decision_id from public.time_period_finding_decisions
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return decision_id; end if;
  insert into public.time_period_finding_decisions (
    organization_id, finding_id, decision, reason, decided_by, operation_id, responsibility_snapshot
  ) values (
    p_organization_id, p_finding_id, p_decision, p_reason, p_actor_id, p_operation_id,
    jsonb_build_object('responsibility', 'time_approval', 'captured_at', now())
  ) returning id into decision_id;
  return decision_id;
end;
$$;

create or replace function public.close_time_period(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  calculation_record public.time_period_calculations%rowtype;
  close_id uuid := gen_random_uuid(); close_version integer;
  prior_close_id uuid; current_fingerprint text; employee_result record;
  account_record public.time_accounts%rowtype; close_minutes integer; event_operation_id uuid;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into prior_close_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event where event.organization_id = p_organization_id
      and event.operation_id = p_operation_id and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return prior_close_id;
  end if;
  select * into period_record from public.time_periods where id = p_period_id and organization_id = p_organization_id for update;
  if not found then raise exception 'period_not_found'; end if;
  if period_record.state = 'closed' then raise exception 'period_closed'; end if;
  if period_record.period_end_date >= (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'period_not_ended'; end if;
  select * into calculation_record from public.time_period_calculations
  where id = period_record.current_calculation_id and organization_id = p_organization_id;
  if not found then raise exception 'period_not_prepared'; end if;
  current_fingerprint := app_private.compute_p1_23_source_fingerprint(p_organization_id);
  if current_fingerprint <> calculation_record.source_fingerprint then raise exception 'stale_calculation'; end if;
  if exists (
    select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id
      and finding.severity = 'close_blocked'
  ) then raise exception 'close_blocked_finding'; end if;
  if exists (
    select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id and finding.severity = 'approval_required'
      and not exists (select 1 from public.time_period_finding_decisions decision
        where decision.finding_id = finding.id and decision.decision = 'approved')
  ) then raise exception 'approval_required_finding'; end if;

  select coalesce(max(version), 0) + 1 into close_version from public.time_period_close_versions where period_id = p_period_id;
  insert into public.time_period_close_versions (
    id, organization_id, period_id, calculation_id, version, supersedes_close_version_id,
    source_fingerprint, opening_balance_total_minutes, period_delta_total_minutes,
    closing_balance_total_minutes, closed_by
  ) select close_id, p_organization_id, p_period_id, calculation_record.id, close_version,
    period_record.current_close_version_id, calculation_record.source_fingerprint,
    coalesce(sum(previous_balance_minutes), 0), coalesce(sum(period_delta_minutes), 0),
    coalesce(sum(closing_balance_minutes), 0), p_actor_id
  from public.time_period_employee_results where calculation_id = calculation_record.id;

  for employee_result in select * from public.time_period_employee_results where calculation_id = calculation_record.id loop
    select * into account_record from public.time_accounts
      where organization_id = p_organization_id and employee_record_id = employee_result.employee_record_id for update;
    if not found then raise exception 'missing_time_account'; end if;
    close_minutes := employee_result.period_delta_minutes - employee_result.account_event_minutes;
    event_operation_id := gen_random_uuid();
    insert into public.time_account_events (
      organization_id, account_id, employee_record_id, event_kind, effective_date,
      minutes, reason, close_version_id, operation_id, request_hash, created_by
    ) values (
      p_organization_id, account_record.id, employee_result.employee_record_id, 'period_close',
      period_record.period_end_date, close_minutes, 'Periodenabschluss ' || period_record.period_start_date::text,
      close_id, event_operation_id, p_request_hash, p_actor_id
    );
    update public.time_accounts set current_balance_minutes = employee_result.closing_balance_minutes,
      last_closed_period_end_date = period_record.period_end_date, version = version + 1, updated_at = now()
    where id = account_record.id;
  end loop;
  update public.time_periods set state = 'closed', current_close_version_id = close_id,
    version = version + 1, updated_at = now() where id = p_period_id;
  insert into public.time_period_events (
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, event_payload
  ) values (p_organization_id, p_period_id, 'closed', calculation_record.id, close_id,
    p_operation_id, p_request_hash, p_actor_id, jsonb_build_object('close_version', close_version));
  return close_id;
end;
$$;

create or replace function public.reopen_time_period(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_reason text, p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare period_record public.time_periods%rowtype; close_record public.time_period_close_versions%rowtype;
  close_event record; reversal_id uuid; account_record public.time_accounts%rowtype;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into reversal_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event where event.organization_id = p_organization_id
      and event.operation_id = p_operation_id and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return reversal_id;
  end if;
  select * into period_record from public.time_periods where id = p_period_id and organization_id = p_organization_id for update;
  if not found or period_record.state <> 'closed' then raise exception 'period_not_closed'; end if;
  select * into close_record from public.time_period_close_versions where id = period_record.current_close_version_id;
  for close_event in select * from public.time_account_events
    where close_version_id = close_record.id and event_kind = 'period_close' loop
    select * into account_record from public.time_accounts where id = close_event.account_id for update;
    reversal_id := gen_random_uuid();
    insert into public.time_account_events (
      id, organization_id, account_id, employee_record_id, event_kind, effective_date,
      minutes, reason, close_version_id, reverses_event_id, operation_id, request_hash, created_by
    ) values (
      reversal_id, p_organization_id, close_event.account_id, close_event.employee_record_id,
      'period_reopen_reversal', period_record.period_end_date, -close_event.minutes, p_reason,
      close_record.id, close_event.id, gen_random_uuid(),
      p_request_hash, p_actor_id
    );
    update public.time_accounts set current_balance_minutes = current_balance_minutes - close_event.minutes,
      last_closed_period_end_date = null, version = version + 1, updated_at = now() where id = account_record.id;
  end loop;
  update public.time_periods set state = 'reopened', version = version + 1, updated_at = now() where id = p_period_id;
  insert into public.time_period_events (
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, reason
  ) values (p_organization_id, p_period_id, 'reopened', period_record.current_calculation_id,
    close_record.id, p_operation_id, p_request_hash, p_actor_id, p_reason);
  return close_record.id;
end;
$$;

create or replace function public.create_payroll_mapping_version(
  p_actor_id uuid, p_organization_id uuid, p_employee_mappings jsonb,
  p_code_mappings jsonb, p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; mapping_version_id uuid; next_version integer;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  select id into mapping_version_id from public.payroll_mapping_versions
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.payroll_mapping_versions where id = mapping_version_id and request_hash = p_request_hash)
      then raise exception 'operation_id_conflict'; end if;
    return mapping_version_id;
  end if;
  insert into public.payroll_mapping_profiles (organization_id, created_by)
    values (p_organization_id, p_actor_id) on conflict (organization_id) do nothing;
  select id into v_profile_id from public.payroll_mapping_profiles where organization_id = p_organization_id for update;
  select coalesce(max(version), 0) + 1 into next_version from public.payroll_mapping_versions
    where profile_id = v_profile_id;
  mapping_version_id := gen_random_uuid();
  insert into public.payroll_mapping_versions (
    id, organization_id, profile_id, version, operation_id, request_hash, confirmed_by
  ) values (mapping_version_id, p_organization_id, v_profile_id, next_version, p_operation_id, p_request_hash, p_actor_id);
  insert into public.payroll_employee_mappings (
    organization_id, mapping_version_id, employee_record_id, external_employee_reference
  ) select p_organization_id, mapping_version_id, (value->>'employee_record_id')::uuid,
    value->>'external_employee_reference' from jsonb_array_elements(p_employee_mappings);
  insert into public.payroll_code_mappings (
    organization_id, mapping_version_id, value_kind, activity_kind, output_code
  ) select p_organization_id, mapping_version_id,
    (value->>'value_kind')::public.payroll_mapping_value_kind,
    nullif(value->>'activity_kind', '')::public.time_segment_kind, value->>'output_code'
    from jsonb_array_elements(p_code_mappings);
  update public.payroll_mapping_profiles set current_version_id = mapping_version_id,
    version = version + 1, updated_at = now() where id = v_profile_id;
  return mapping_version_id;
end;
$$;

create or replace function public.reserve_payroll_export(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid, p_mapping_version_id uuid,
  p_generator_version text, p_content_fingerprint text, p_supersedes_export_id uuid,
  p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare period_record public.time_periods%rowtype; export_id uuid; next_version integer;
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  select id into export_id from public.payroll_exports where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.payroll_exports where id = export_id and request_hash = p_request_hash)
      then raise exception 'operation_id_conflict'; end if;
    return export_id;
  end if;
  select * into period_record from public.time_periods where id = p_period_id and organization_id = p_organization_id;
  if not found or period_record.state <> 'closed' then raise exception 'period_not_closed'; end if;
  if not exists (select 1 from public.payroll_mapping_versions where id = p_mapping_version_id and organization_id = p_organization_id)
    then raise exception 'mapping_not_found'; end if;
  if exists (
    select 1 from public.time_period_employee_results result
    where result.calculation_id = period_record.current_calculation_id and not exists (
      select 1 from public.payroll_employee_mappings mapping
      where mapping.mapping_version_id = p_mapping_version_id and mapping.employee_record_id = result.employee_record_id
    )
  ) then raise exception 'missing_employee_mapping'; end if;
  if exists (
    select required.value_kind, required.activity_kind
    from (
      select value_kind, null::public.time_segment_kind as activity_kind
      from unnest(enum_range(null::public.payroll_mapping_value_kind)) value_kind
      where value_kind <> 'credited_activity'
      union all
      select 'credited_activity'::public.payroll_mapping_value_kind, activity_kind
      from unnest(enum_range(null::public.time_segment_kind)) activity_kind
    ) required
    where not exists (
      select 1 from public.payroll_code_mappings mapping
      where mapping.mapping_version_id = p_mapping_version_id
        and mapping.value_kind = required.value_kind
        and mapping.activity_kind is not distinct from required.activity_kind
    )
  ) then raise exception 'missing_code_mapping'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.payroll_exports
    where close_version_id = period_record.current_close_version_id;
  export_id := gen_random_uuid();
  insert into public.payroll_exports (
    id, organization_id, period_id, close_version_id, mapping_version_id,
    operation_id, request_hash, version, state, generator_version,
    content_fingerprint, supersedes_export_id, requested_by
  ) values (export_id, p_organization_id, p_period_id, period_record.current_close_version_id,
    p_mapping_version_id, p_operation_id, p_request_hash, next_version, 'generating',
    p_generator_version, p_content_fingerprint, p_supersedes_export_id, p_actor_id);
  insert into public.payroll_export_events (organization_id, export_id, event_type, operation_id, actor_id)
    values (p_organization_id, export_id, 'generating', gen_random_uuid(), p_actor_id);
  return export_id;
end;
$$;

create or replace function public.finalize_payroll_export(
  p_actor_id uuid, p_organization_id uuid, p_export_id uuid, p_document_id uuid,
  p_zip_sha256 text, p_size_bytes bigint, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare export_record public.payroll_exports%rowtype;
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  select * into export_record from public.payroll_exports where id = p_export_id and organization_id = p_organization_id for update;
  if not found then raise exception 'export_not_found'; end if;
  if export_record.state = 'ready' then return p_export_id; end if;
  if export_record.state <> 'generating' then raise exception 'invalid_export_state'; end if;
  update public.payroll_exports set state = 'ready', document_id = p_document_id,
    zip_sha256 = p_zip_sha256, size_bytes = p_size_bytes, ready_at = now(), updated_at = now()
    where id = p_export_id;
  if export_record.supersedes_export_id is not null then
    update public.payroll_exports set state = 'superseded', updated_at = now()
      where id = export_record.supersedes_export_id and state = 'ready';
  end if;
  insert into public.payroll_export_events (organization_id, export_id, event_type, operation_id, actor_id,
    event_payload) values (p_organization_id, p_export_id, 'ready', p_operation_id, p_actor_id,
      jsonb_build_object('document_id', p_document_id, 'zip_sha256', p_zip_sha256, 'size_bytes', p_size_bytes));
  return p_export_id;
end;
$$;

create or replace function public.fail_payroll_export(
  p_actor_id uuid, p_organization_id uuid, p_export_id uuid,
  p_failure_reason text, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  update public.payroll_exports set state = 'failed', failure_reason = p_failure_reason, updated_at = now()
    where id = p_export_id and organization_id = p_organization_id and state in ('requested', 'generating');
  if not found and not exists (select 1 from public.payroll_exports where id = p_export_id and state = 'failed')
    then raise exception 'invalid_export_state'; end if;
  insert into public.payroll_export_events (organization_id, export_id, event_type, operation_id, actor_id,
    event_payload) values (p_organization_id, p_export_id, 'failed', p_operation_id, p_actor_id,
      jsonb_build_object('failure_reason', p_failure_reason)) on conflict (organization_id, operation_id) do nothing;
  return p_export_id;
end;
$$;

revoke all on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from public;
revoke all on function public.decide_time_period_finding(uuid, uuid, uuid, public.time_period_finding_decision, text, uuid) from public;
revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) from public;
revoke all on function public.create_payroll_mapping_version(uuid, uuid, jsonb, jsonb, uuid, text) from public;
revoke all on function public.reserve_payroll_export(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text) from public;
revoke all on function public.finalize_payroll_export(uuid, uuid, uuid, uuid, text, bigint, uuid) from public;
revoke all on function public.fail_payroll_export(uuid, uuid, uuid, text, uuid) from public;
grant execute on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.decide_time_period_finding(uuid, uuid, uuid, public.time_period_finding_decision, text, uuid) to service_role;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.create_payroll_mapping_version(uuid, uuid, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.reserve_payroll_export(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text) to service_role;
grant execute on function public.finalize_payroll_export(uuid, uuid, uuid, uuid, text, bigint, uuid) to service_role;
grant execute on function public.fail_payroll_export(uuid, uuid, uuid, text, uuid) to service_role;
