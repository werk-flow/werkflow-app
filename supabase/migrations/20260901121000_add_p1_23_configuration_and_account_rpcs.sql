-- P1-23 configuration, account-ledger and source-fingerprint transaction boundaries.

create or replace function app_private.assert_p1_23_period_open(
  p_organization_id uuid, p_effective_date date
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.time_periods period
    where period.organization_id = p_organization_id
      and period.state = 'closed'
      and p_effective_date between period.period_start_date and period.period_end_date
  ) then
    raise exception 'period_closed';
  end if;
end;
$$;

create or replace function app_private.compute_p1_23_source_fingerprint(
  p_organization_id uuid
)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_object(
    'time_entries', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_entries row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'time_sessions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_sessions row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'time_segments', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_segments row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'correction_requests', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_correction_requests row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'correction_applications', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_correction_applications row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'work_schedules', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.work_schedules row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'employment_conditions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.employment_conditions row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'vacation_requests', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.vacation_requests row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'sickness_reports', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.sickness_reports row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'policy_versions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_policy_versions row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'policy_assignments', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_policy_assignments row_value where row_value.organization_id = p_organization_id), '[]'::jsonb),
    'account_events', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_events row_value where row_value.organization_id = p_organization_id), '[]'::jsonb)
  )::text, 'sha256'), 'hex');
$$;

create or replace function public.create_time_account_policy_version(
  p_organization_id uuid,
  p_policy_id uuid,
  p_name text,
  p_is_default boolean,
  p_effective_from date,
  p_vacation_treatment public.time_absence_treatment,
  p_sickness_treatment public.time_absence_treatment,
  p_night_window_start time,
  p_night_window_end time,
  p_credit_rules jsonb,
  p_supplement_rules jsonb,
  p_warning_rules jsonb,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  resolved_policy_id uuid := p_policy_id;
  new_version_id uuid;
  next_version integer;
  existing_record record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':time_policy', 0));
  select id, request_hash into existing_record
  from public.time_account_policy_versions
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if existing_record.request_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return existing_record.id;
  end if;
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if nullif(btrim(p_name), '') is null then raise exception 'invalid_policy_name'; end if;
  if jsonb_typeof(p_credit_rules) <> 'array'
     or jsonb_typeof(p_supplement_rules) <> 'array'
     or jsonb_typeof(p_warning_rules) <> 'array' then
    raise exception 'invalid_policy_rules';
  end if;

  if resolved_policy_id is null then
    insert into public.time_account_policies(organization_id, name, is_default, created_by)
    values (p_organization_id, btrim(p_name), false, p_actor_id)
    returning id into resolved_policy_id;
  elsif not exists (
    select 1 from public.time_account_policies policy
    where policy.id = resolved_policy_id and policy.organization_id = p_organization_id and policy.retired_at is null
  ) then raise exception 'policy_not_found'; end if;

  if p_is_default then
    update public.time_account_policies set is_default = false, version = version + 1
    where organization_id = p_organization_id and is_default and id <> resolved_policy_id;
  end if;
  update public.time_account_policies
  set name = btrim(p_name), is_default = p_is_default, version = version + 1
  where id = resolved_policy_id;

  select coalesce(max(version), 0) + 1 into next_version
  from public.time_account_policy_versions where policy_id = resolved_policy_id;
  insert into public.time_account_policy_versions(
    organization_id, policy_id, version, effective_from,
    vacation_treatment, sickness_treatment, night_window_start, night_window_end,
    operation_id, request_hash, confirmed_by
  ) values (
    p_organization_id, resolved_policy_id, next_version, p_effective_from,
    p_vacation_treatment, p_sickness_treatment, p_night_window_start, p_night_window_end,
    p_operation_id, p_request_hash, p_actor_id
  ) returning id into new_version_id;

  insert into public.time_account_policy_credit_rules(
    organization_id, policy_version_id, activity_kind, travel_route,
    travel_role, standby_context, credit_percentage
  )
  select p_organization_id, new_version_id, activity_kind, travel_route,
    travel_role, standby_context, credit_percentage
  from jsonb_to_recordset(p_credit_rules) as rule(
    activity_kind public.time_segment_kind,
    travel_route public.time_travel_route,
    travel_role public.time_travel_role,
    standby_context public.time_standby_context,
    credit_percentage smallint
  );
  if (select count(*) from public.time_account_policy_credit_rules where policy_version_id = new_version_id) <> 25 then
    raise exception 'policy_credit_rules_incomplete';
  end if;

  insert into public.time_account_policy_supplement_rules(
    organization_id, policy_version_id, supplement_kind, activity_kind, enabled
  )
  select p_organization_id, new_version_id, supplement_kind, activity_kind, enabled
  from jsonb_to_recordset(p_supplement_rules) as rule(
    supplement_kind public.time_supplement_kind,
    activity_kind public.time_segment_kind,
    enabled boolean
  );
  if (select count(*) from public.time_account_policy_supplement_rules where policy_version_id = new_version_id) <> 18 then
    raise exception 'policy_supplement_rules_incomplete';
  end if;

  insert into public.time_account_policy_warning_rules(
    organization_id, policy_version_id, warning_kind, enabled, severity, threshold_minutes
  )
  select p_organization_id, new_version_id, warning_kind, enabled, severity, threshold_minutes
  from jsonb_to_recordset(p_warning_rules) as rule(
    warning_kind public.time_policy_warning_kind,
    enabled boolean,
    severity public.time_finding_severity,
    threshold_minutes integer
  );
  if (select count(*) from public.time_account_policy_warning_rules where policy_version_id = new_version_id) <> 6 then
    raise exception 'policy_warning_rules_incomplete';
  end if;
  return new_version_id;
end;
$$;

create or replace function public.assign_time_account_policy(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_policy_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result_id uuid;
  existing_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':policy_assignment:' || p_employee_record_id::text, 0));
  select id, request_hash into result_id, existing_hash
  from public.time_account_policy_assignments
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return result_id;
  end if;
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'not_authorized'; end if;
  insert into public.time_account_policy_assignments(
    organization_id, employee_record_id, policy_id, valid_from, valid_until,
    operation_id, request_hash, assigned_by, reason
  ) values (
    p_organization_id, p_employee_record_id, p_policy_id, p_valid_from, p_valid_until,
    p_operation_id, p_request_hash, p_actor_id, p_reason
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.open_time_account(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_opening_minutes integer,
  p_opened_on date,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result_account_id uuid;
  existing_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':time_account:' || p_employee_record_id::text, 0));
  select account_id, request_hash into result_account_id, existing_hash
  from public.time_account_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return result_account_id;
  end if;
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'not_authorized'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if not exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
  ) then raise exception 'employee_not_found'; end if;
  insert into public.time_accounts(organization_id, employee_record_id, opened_on, opened_by)
  values (p_organization_id, p_employee_record_id, p_opened_on, p_actor_id)
  returning id into result_account_id;
  insert into public.time_account_events(
    organization_id, account_id, employee_record_id, event_kind, effective_date,
    minutes, reason, operation_id, request_hash, created_by
  ) values (
    p_organization_id, result_account_id, p_employee_record_id, 'opening_balance', p_opened_on,
    p_opening_minutes, p_reason, p_operation_id, p_request_hash, p_actor_id
  );
  return result_account_id;
end;
$$;

create or replace function public.submit_time_account_adjustment(
  p_organization_id uuid,
  p_account_id uuid,
  p_expected_account_version bigint,
  p_adjustment_kind public.time_account_adjustment_kind,
  p_minutes integer,
  p_effective_date date,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  account_record public.time_accounts;
  result_id uuid;
  existing_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':time_account:' || p_account_id::text, 0));
  select id, request_hash into result_id, existing_hash
  from public.time_account_adjustment_requests
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return result_id;
  end if;
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then raise exception 'not_authorized'; end if;
  select * into account_record from public.time_accounts
  where id = p_account_id and organization_id = p_organization_id for update;
  if account_record.id is null then raise exception 'account_not_found'; end if;
  if account_record.version <> p_expected_account_version then raise exception 'stale_version'; end if;
  if p_minutes = 0 or nullif(btrim(p_reason), '') is null then raise exception 'invalid_adjustment'; end if;
  perform app_private.assert_p1_23_period_open(p_organization_id, p_effective_date);
  insert into public.time_account_adjustment_requests(
    organization_id, account_id, employee_record_id, operation_id, request_hash,
    adjustment_kind, minutes, effective_date, reason, requested_by
  ) values (
    p_organization_id, p_account_id, account_record.employee_record_id, p_operation_id, p_request_hash,
    p_adjustment_kind, p_minutes, p_effective_date, p_reason, p_actor_id
  ) returning id into result_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason
  ) values (p_organization_id, result_id, 'submitted', p_actor_id, p_operation_id, p_reason);
  update public.time_accounts set version = version + 1 where id = p_account_id;
  return result_id;
end;
$$;

create or replace function public.decide_time_account_adjustment(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_version bigint,
  p_decision public.time_period_finding_decision,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_record public.time_account_adjustment_requests;
  prior_event_id uuid;
  event_kind public.time_account_event_kind;
begin
  select request_id into prior_event_id from public.time_account_adjustment_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return prior_event_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':adjustment:' || p_request_id::text, 0));
  select * into request_record from public.time_account_adjustment_requests
  where id = p_request_id and organization_id = p_organization_id for update;
  if request_record.id is null then raise exception 'request_not_found'; end if;
  if request_record.version <> p_expected_version then raise exception 'stale_version'; end if;
  if request_record.status <> 'submitted' then raise exception 'request_not_pending'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if not app_private.can_p1_23_approve_employee(p_organization_id, p_actor_id, request_record.employee_record_id) then
    raise exception 'not_responsible_or_self_approval';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.time_account_adjustment_requests set
    status = case when p_decision = 'approved' then 'approved'::public.time_account_request_status else 'rejected'::public.time_account_request_status end,
    version = version + 1, decided_by = p_actor_id, decision_reason = p_reason, decided_at = clock_timestamp()
  where id = p_request_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason,
    responsibility_snapshot
  ) values (
    p_organization_id, p_request_id, p_decision::text, p_actor_id, p_operation_id, p_reason,
    jsonb_build_object('responsibility', 'time_approval', 'actorId', p_actor_id)
  );
  if p_decision = 'approved' then
    event_kind := request_record.adjustment_kind::text::public.time_account_event_kind;
    perform app_private.assert_p1_23_period_open(p_organization_id, request_record.effective_date);
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind, effective_date,
      minutes, reason, adjustment_request_id, operation_id, request_hash, created_by
    ) values (
      p_organization_id, request_record.account_id, request_record.employee_record_id,
      event_kind, request_record.effective_date, request_record.minutes, request_record.reason,
      request_record.id, gen_random_uuid(), request_record.request_hash, p_actor_id
    );
  end if;
  update public.time_accounts set version = version + 1 where id = request_record.account_id;
  return p_request_id;
end;
$$;

revoke all on function app_private.assert_p1_23_period_open(uuid, date) from public;
revoke all on function app_private.compute_p1_23_source_fingerprint(uuid) from public;
grant execute on function app_private.assert_p1_23_period_open(uuid, date) to service_role;
grant execute on function app_private.compute_p1_23_source_fingerprint(uuid) to service_role;

revoke all on function public.create_time_account_policy_version(uuid, uuid, text, boolean, date, public.time_absence_treatment, public.time_absence_treatment, time, time, jsonb, jsonb, jsonb, uuid, uuid, text) from public;
revoke all on function public.assign_time_account_policy(uuid, uuid, uuid, date, date, text, uuid, uuid, text) from public;
revoke all on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) from public;
revoke all on function public.submit_time_account_adjustment(uuid, uuid, bigint, public.time_account_adjustment_kind, integer, date, text, uuid, uuid, text) from public;
revoke all on function public.decide_time_account_adjustment(uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid) from public;
grant execute on function public.create_time_account_policy_version(uuid, uuid, text, boolean, date, public.time_absence_treatment, public.time_absence_treatment, time, time, jsonb, jsonb, jsonb, uuid, uuid, text) to service_role;
grant execute on function public.assign_time_account_policy(uuid, uuid, uuid, date, date, text, uuid, uuid, text) to service_role;
grant execute on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) to service_role;
grant execute on function public.submit_time_account_adjustment(uuid, uuid, bigint, public.time_account_adjustment_kind, integer, date, text, uuid, uuid, text) to service_role;
grant execute on function public.decide_time_account_adjustment(uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid) to service_role;
