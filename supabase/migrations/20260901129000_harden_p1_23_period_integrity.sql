-- Harden P1-23 integrity after the first implementation review. These checks
-- deliberately live at the database boundary so service-role callers cannot
-- construct cross-calculation snapshots or mutate unrelated account state.

create or replace function app_private.is_p1_23_employee_record_actor(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id
      and employee.organization_id = p_organization_id
      and employee.user_id = p_actor_id
  );
$$;

drop policy if exists time_accounts_permitted_select on public.time_accounts;
create policy time_accounts_permitted_select
on public.time_accounts for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_employee_record_actor(
    organization_id, employee_record_id, (select auth.uid())
  )
);

drop policy if exists time_account_events_permitted_select on public.time_account_events;
create policy time_account_events_permitted_select
on public.time_account_events for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_employee_record_actor(
    organization_id, employee_record_id, (select auth.uid())
  )
);

drop policy if exists time_account_adjustment_requests_permitted_select
  on public.time_account_adjustment_requests;
create policy time_account_adjustment_requests_permitted_select
on public.time_account_adjustment_requests for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or requested_by = (select auth.uid())
  or app_private.is_p1_23_employee_record_actor(
    organization_id, employee_record_id, (select auth.uid())
  )
);

drop policy if exists time_period_employee_results_permitted_select
  on public.time_period_employee_results;
create policy time_period_employee_results_permitted_select
on public.time_period_employee_results for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or app_private.is_p1_23_employee_record_actor(
    organization_id, employee_record_id, (select auth.uid())
  )
);

drop policy if exists time_period_daily_results_permitted_select
  on public.time_period_daily_results;
create policy time_period_daily_results_permitted_select
on public.time_period_daily_results for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or app_private.is_p1_23_employee_record_actor(
    organization_id, employee_record_id, (select auth.uid())
  )
);

drop policy if exists time_period_findings_permitted_select
  on public.time_period_findings;
create policy time_period_findings_permitted_select
on public.time_period_findings for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or (
    employee_record_id is not null
    and app_private.is_p1_23_employee_record_actor(
      organization_id, employee_record_id, (select auth.uid())
    )
  )
);

drop policy if exists time_account_adjustment_events_permitted_select
  on public.time_account_adjustment_events;
create policy time_account_adjustment_events_permitted_select
on public.time_account_adjustment_events for select to authenticated using (
  exists (
    select 1 from public.time_account_adjustment_requests request
    where request.id = time_account_adjustment_events.request_id
      and request.organization_id = time_account_adjustment_events.organization_id
      and (
        request.requested_by = (select auth.uid())
        or request.organization_id in (
          select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
        )
        or app_private.is_p1_23_employee_record_actor(
          request.organization_id, request.employee_record_id, (select auth.uid())
        )
      )
  )
);

drop policy if exists time_period_result_sources_permitted_select
  on public.time_period_result_sources;
create policy time_period_result_sources_permitted_select
on public.time_period_result_sources for select to authenticated using (
  exists (
    select 1 from public.time_period_employee_results result
    where result.id = time_period_result_sources.employee_result_id
      and result.organization_id = time_period_result_sources.organization_id
      and (
        result.organization_id in (
          select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
        )
        or app_private.is_p1_23_time_holder(result.organization_id, (select auth.uid()))
        or app_private.is_p1_23_employee_record_actor(
          result.organization_id, result.employee_record_id, (select auth.uid())
        )
      )
  )
);

drop policy if exists time_period_finding_decisions_permitted_select
  on public.time_period_finding_decisions;
create policy time_period_finding_decisions_permitted_select
on public.time_period_finding_decisions for select to authenticated using (
  exists (
    select 1 from public.time_period_findings finding
    where finding.id = time_period_finding_decisions.finding_id
      and finding.organization_id = time_period_finding_decisions.organization_id
      and (
        finding.organization_id in (
          select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
        )
        or app_private.is_p1_23_time_holder(finding.organization_id, (select auth.uid()))
        or (
          finding.employee_record_id is not null
          and app_private.is_p1_23_employee_record_actor(
            finding.organization_id, finding.employee_record_id, (select auth.uid())
          )
        )
      )
  )
);

drop policy if exists time_period_close_versions_managers_select
  on public.time_period_close_versions;
create policy time_period_close_versions_managers_select
on public.time_period_close_versions for select to authenticated using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or app_private.is_p1_23_time_holder(organization_id, (select auth.uid()))
  or exists (
    select 1 from public.time_period_employee_results result
    where result.calculation_id = time_period_close_versions.calculation_id
      and result.organization_id = time_period_close_versions.organization_id
      and app_private.is_p1_23_employee_record_actor(
        result.organization_id, result.employee_record_id, (select auth.uid())
      )
  )
);

create or replace function app_private.guard_time_correction_closed_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fact jsonb;
  timestamp_text text;
  local_date date;
begin
  for fact in
    select value from jsonb_array_elements(coalesce(new.before_snapshot -> 'facts', '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(new.applied_snapshot -> 'facts', '[]'::jsonb))
  loop
    timestamp_text := nullif(fact ->> 'timestamp', '');
    if timestamp_text is null then
      raise exception 'time_correction_timestamp_invalid';
    end if;
    begin
      local_date := (timestamp_text::timestamptz at time zone 'Europe/Berlin')::date;
    exception when others then
      raise exception 'time_correction_timestamp_invalid';
    end;
    perform app_private.assert_p1_23_period_open(new.organization_id, local_date);
  end loop;
  return new;
end;
$$;

create or replace function app_private.guard_p1_23_snapshot_relationships()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  parent_employee_id uuid;
  parent_organization_id uuid;
begin
  if tg_table_name = 'time_period_daily_results' then
    select result.employee_record_id, result.organization_id
      into parent_employee_id, parent_organization_id
    from public.time_period_employee_results result
    where result.id = new.employee_result_id;
    if parent_employee_id is distinct from new.employee_record_id
       or parent_organization_id is distinct from new.organization_id then
      raise exception 'invalid_daily_result_parent';
    end if;
    if not exists (
      select 1
      from public.time_period_employee_results result
      join public.time_period_calculations calculation on calculation.id = result.calculation_id
      join public.time_periods period on period.id = calculation.period_id
      where result.id = new.employee_result_id
        and new.local_date between period.period_start_date and period.period_end_date
    ) then
      raise exception 'daily_result_outside_period';
    end if;
  elsif tg_table_name = 'time_period_result_sources' and new.daily_result_id is not null then
    if not exists (
      select 1 from public.time_period_daily_results daily
      where daily.id = new.daily_result_id
        and daily.employee_result_id = new.employee_result_id
        and daily.organization_id = new.organization_id
    ) then
      raise exception 'invalid_result_source_parent';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_p1_23_daily_result_relationships
  on public.time_period_daily_results;
create trigger guard_p1_23_daily_result_relationships
before insert or update on public.time_period_daily_results
for each row execute function app_private.guard_p1_23_snapshot_relationships();

drop trigger if exists guard_p1_23_result_source_relationships
  on public.time_period_result_sources;
create trigger guard_p1_23_result_source_relationships
before insert or update on public.time_period_result_sources
for each row execute function app_private.guard_p1_23_snapshot_relationships();

create or replace function app_private.compute_p1_23_source_fingerprint(
  p_organization_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_object(
    'employees', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.employee_records row_value
      where row_value.organization_id = p_organization_id
        and coalesce(row_value.entry_date, p_period_start_date) <= p_period_end_date
        and coalesce(row_value.exit_date, p_period_end_date) >= p_period_start_date), '[]'::jsonb),
    'time_entries', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_entries row_value
      where row_value.organization_id = p_organization_id
        and row_value.timestamp >= ((p_period_start_date - 1)::timestamp at time zone 'Europe/Berlin')
        and row_value.timestamp < ((p_period_end_date + 1)::timestamp at time zone 'Europe/Berlin')), '[]'::jsonb),
    'time_sessions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_sessions row_value
      where row_value.organization_id = p_organization_id
        and row_value.started_at < ((p_period_end_date + 1)::timestamp at time zone 'Europe/Berlin')
        and coalesce(row_value.ended_at, 'infinity'::timestamptz)
          > (p_period_start_date::timestamp at time zone 'Europe/Berlin')), '[]'::jsonb),
    'time_segments', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_segments row_value
      where row_value.organization_id = p_organization_id
        and row_value.started_at < ((p_period_end_date + 1)::timestamp at time zone 'Europe/Berlin')
        and coalesce(row_value.ended_at, 'infinity'::timestamptz)
          > (p_period_start_date::timestamp at time zone 'Europe/Berlin')), '[]'::jsonb),
    'correction_requests', coalesce((select jsonb_agg(to_jsonb(request_value) order by request_value.id)
      from public.time_correction_requests request_value
      where request_value.organization_id = p_organization_id
        and exists (
          select 1 from public.time_correction_request_revisions revision,
            jsonb_array_elements(coalesce(revision.proposed_snapshot -> 'facts', '[]'::jsonb)) fact
          where revision.request_id = request_value.id
            and nullif(fact.value ->> 'timestamp', '') is not null
            and ((fact.value ->> 'timestamp')::timestamptz at time zone 'Europe/Berlin')::date
              between p_period_start_date and p_period_end_date
        )), '[]'::jsonb),
    'correction_revisions', coalesce((select jsonb_agg(to_jsonb(revision_value)
        order by revision_value.request_id, revision_value.revision)
      from public.time_correction_request_revisions revision_value
      where revision_value.organization_id = p_organization_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(revision_value.proposed_snapshot -> 'facts', '[]'::jsonb)) fact
          where nullif(fact.value ->> 'timestamp', '') is not null
            and ((fact.value ->> 'timestamp')::timestamptz at time zone 'Europe/Berlin')::date
              between p_period_start_date and p_period_end_date
        )), '[]'::jsonb),
    'correction_applications', coalesce((select jsonb_agg(to_jsonb(application_value) order by application_value.id)
      from public.time_correction_applications application_value
      where application_value.organization_id = p_organization_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(application_value.applied_snapshot -> 'facts', '[]'::jsonb)) fact
          where nullif(fact.value ->> 'timestamp', '') is not null
            and ((fact.value ->> 'timestamp')::timestamptz at time zone 'Europe/Berlin')::date
              between p_period_start_date and p_period_end_date
        )), '[]'::jsonb),
    'work_schedules', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.work_schedules row_value where row_value.organization_id = p_organization_id
        and row_value.valid_from <= p_period_end_date), '[]'::jsonb),
    'employment_conditions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.employment_conditions row_value where row_value.organization_id = p_organization_id
        and row_value.valid_from <= p_period_end_date), '[]'::jsonb),
    'vacation_requests', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.vacation_requests row_value where row_value.organization_id = p_organization_id
        and row_value.start_date <= p_period_end_date and row_value.end_date >= p_period_start_date), '[]'::jsonb),
    'sickness_reports', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.sickness_reports row_value where row_value.organization_id = p_organization_id
        and row_value.start_date <= p_period_end_date
        and coalesce(row_value.end_date, p_period_end_date) >= p_period_start_date), '[]'::jsonb),
    'policy_versions', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_policy_versions row_value where row_value.organization_id = p_organization_id
        and row_value.effective_from <= p_period_end_date), '[]'::jsonb),
    'policy_assignments', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_policy_assignments row_value where row_value.organization_id = p_organization_id
        and row_value.valid_from <= p_period_end_date
        and coalesce(row_value.valid_until, p_period_end_date) >= p_period_start_date), '[]'::jsonb),
    'account_events', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.time_account_events row_value where row_value.organization_id = p_organization_id
        and row_value.effective_date <= p_period_end_date), '[]'::jsonb)
  )::text, 'sha256'), 'hex');
$$;

create or replace function public.get_time_period_source_fingerprint(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  return app_private.compute_p1_23_source_fingerprint(
    p_organization_id, p_period_start_date, p_period_end_date
  );
end;
$$;

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
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_source_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  if p_period_start_date <> date_trunc('month', p_period_start_date)::date
     or p_period_end_date <> (date_trunc('month', p_period_start_date) + interval '1 month - 1 day')::date
    then raise exception 'invalid_period_boundary'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || p_period_start_date::text, 0
  ));
  select event.calculation_id into prior_calculation_id
  from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return prior_calculation_id;
  end if;
  current_fingerprint := app_private.compute_p1_23_source_fingerprint(
    p_organization_id, p_period_start_date, p_period_end_date
  );
  if current_fingerprint <> p_source_fingerprint then raise exception 'stale_source_fingerprint'; end if;
  select count(*) into expected_employee_count from public.employee_records employee
  where employee.organization_id = p_organization_id
    and coalesce(employee.entry_date, p_period_start_date) <= p_period_end_date
    and coalesce(employee.exit_date, p_period_end_date) >= p_period_start_date;
  select count(distinct value ->> 'employee_record_id') into supplied_employee_count
  from jsonb_array_elements(p_employee_results);
  if supplied_employee_count <> expected_employee_count
     or jsonb_array_length(p_employee_results) <> expected_employee_count then
    raise exception 'incomplete_period_population: expected %, supplied %, rows %',
      expected_employee_count, supplied_employee_count, jsonb_array_length(p_employee_results);
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_employee_results) value
    left join public.employee_records employee
      on employee.id = (value ->> 'employee_record_id')::uuid
      and employee.organization_id = p_organization_id
    where employee.id is null
  ) then raise exception 'invalid_employee_result_population'; end if;
  insert into public.time_periods(
    organization_id, period_start_date, period_end_date, prepared_by
  ) values (p_organization_id, p_period_start_date, p_period_end_date, p_actor_id)
  on conflict (organization_id, period_start_date, period_end_date) do nothing;
  select * into period_record from public.time_periods
  where organization_id = p_organization_id
    and period_start_date = p_period_start_date
    and period_end_date = p_period_end_date for update;
  if period_record.state = 'closed' then raise exception 'period_closed'; end if;
  select coalesce(max(version), 0) + 1 into calculation_version
  from public.time_period_calculations where period_id = period_record.id;
  insert into public.time_period_calculations(
    id, organization_id, period_id, version, source_fingerprint,
    target_minutes, source_seconds, credited_minutes, absence_minutes,
    overtime_minutes, account_event_minutes, generated_by
  ) select calculation_id, p_organization_id, period_record.id,
    calculation_version, p_source_fingerprint,
    coalesce(sum((value ->> 'target_minutes')::bigint), 0),
    coalesce(sum((value ->> 'source_seconds')::numeric), 0),
    coalesce(sum((value ->> 'credited_minutes')::bigint), 0),
    coalesce(sum((value ->> 'vacation_minutes')::bigint +
      (value ->> 'sickness_minutes')::bigint), 0),
    coalesce(sum((value ->> 'overtime_candidate_minutes')::bigint), 0),
    coalesce(sum((value ->> 'account_event_minutes')::bigint), 0), p_actor_id
  from jsonb_array_elements(p_employee_results);
  insert into public.time_period_employee_results(
    id, organization_id, calculation_id, employee_record_id, policy_version_id,
    previous_balance_minutes, target_minutes, source_seconds, source_minutes,
    credited_minutes, vacation_minutes, sickness_minutes, account_event_minutes,
    period_delta_minutes, overtime_candidate_minutes, closing_balance_minutes,
    authoritative_targets
  ) select (value ->> 'id')::uuid, p_organization_id, calculation_id,
    (value ->> 'employee_record_id')::uuid,
    nullif(value ->> 'policy_version_id', '')::uuid,
    (value ->> 'previous_balance_minutes')::integer,
    (value ->> 'target_minutes')::integer,
    (value ->> 'source_seconds')::numeric,
    (value ->> 'source_minutes')::integer,
    (value ->> 'credited_minutes')::integer,
    (value ->> 'vacation_minutes')::integer,
    (value ->> 'sickness_minutes')::integer,
    (value ->> 'account_event_minutes')::integer,
    (value ->> 'period_delta_minutes')::integer,
    (value ->> 'overtime_candidate_minutes')::integer,
    (value ->> 'closing_balance_minutes')::integer,
    (value ->> 'authoritative_targets')::boolean
  from jsonb_array_elements(p_employee_results);
  insert into public.time_period_daily_results(
    id, organization_id, employee_result_id, employee_record_id, local_date,
    activity_kind, travel_route, travel_role, standby_context, credit_percentage,
    source_seconds, source_minutes, credited_seconds, credited_minutes,
    rounding_delta_seconds, target_minutes, vacation_minutes, sickness_minutes,
    night_minutes, sunday_minutes, public_holiday_minutes
  ) select (value ->> 'id')::uuid, p_organization_id,
    (value ->> 'employee_result_id')::uuid,
    (value ->> 'employee_record_id')::uuid,
    (value ->> 'local_date')::date,
    (value ->> 'activity_kind')::public.time_segment_kind,
    nullif(value ->> 'travel_route', '')::public.time_travel_route,
    nullif(value ->> 'travel_role', '')::public.time_travel_role,
    nullif(value ->> 'standby_context', '')::public.time_standby_context,
    (value ->> 'credit_percentage')::smallint,
    (value ->> 'source_seconds')::numeric,
    (value ->> 'source_minutes')::integer,
    (value ->> 'credited_seconds')::numeric,
    (value ->> 'credited_minutes')::integer,
    (value ->> 'rounding_delta_seconds')::numeric,
    coalesce((value ->> 'target_minutes')::integer, 0),
    coalesce((value ->> 'vacation_minutes')::integer, 0),
    coalesce((value ->> 'sickness_minutes')::integer, 0),
    coalesce((value ->> 'night_minutes')::integer, 0),
    coalesce((value ->> 'sunday_minutes')::integer, 0),
    coalesce((value ->> 'public_holiday_minutes')::integer, 0)
  from jsonb_array_elements(p_daily_results);
  insert into public.time_period_result_sources(
    organization_id, employee_result_id, daily_result_id, source_kind,
    source_id, source_key, source_fingerprint, source_snapshot
  ) select p_organization_id, (value ->> 'employee_result_id')::uuid,
    nullif(value ->> 'daily_result_id', '')::uuid, value ->> 'source_kind',
    nullif(value ->> 'source_id', '')::uuid, nullif(value ->> 'source_key', ''),
    value ->> 'source_fingerprint', coalesce(value -> 'source_snapshot', '{}'::jsonb)
  from jsonb_array_elements(p_sources);
  insert into public.time_period_findings(
    organization_id, calculation_id, employee_record_id, local_date,
    finding_kind, severity, source_fingerprint, explanation
  ) select p_organization_id, calculation_id,
    nullif(value ->> 'employee_record_id', '')::uuid,
    nullif(value ->> 'local_date', '')::date,
    (value ->> 'finding_kind')::public.time_period_finding_kind,
    (value ->> 'severity')::public.time_finding_severity,
    value ->> 'source_fingerprint', coalesce(value -> 'explanation', '{}'::jsonb)
  from jsonb_array_elements(p_findings);
  update public.time_periods set
    current_calculation_id = calculation_id,
    state = case when state = 'reopened' then 'reopened'::public.time_period_state
      else 'prepared'::public.time_period_state end,
    version = version + 1, updated_at = now()
  where id = period_record.id;
  insert into public.time_period_events(
    organization_id, period_id, event_type, calculation_id, operation_id,
    request_hash, actor_id, event_payload
  ) values (
    p_organization_id, period_record.id,
    case when calculation_version = 1 then 'prepared' else 'recalculated' end,
    calculation_id, p_operation_id, p_request_hash, p_actor_id,
    jsonb_build_object('calculation_version', calculation_version,
      'source_fingerprint', p_source_fingerprint)
  );
  return calculation_id;
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
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':adjustment:' || p_request_id::text, 0
  ));
  select request_id into prior_event_id
  from public.time_account_adjustment_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return prior_event_id; end if;
  select * into request_record from public.time_account_adjustment_requests
  where id = p_request_id and organization_id = p_organization_id for update;
  if request_record.id is null then raise exception 'request_not_found'; end if;
  if request_record.version <> p_expected_version then raise exception 'stale_version'; end if;
  if request_record.status <> 'submitted' then raise exception 'request_not_pending'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if not app_private.can_p1_23_approve_employee(
    p_organization_id, p_actor_id, request_record.employee_record_id
  ) then raise exception 'not_responsible_or_self_approval'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.time_account_adjustment_requests set
    status = case when p_decision = 'approved'
      then 'approved'::public.time_account_request_status
      else 'rejected'::public.time_account_request_status end,
    version = version + 1,
    decided_by = p_actor_id,
    decision_reason = p_reason,
    decided_at = clock_timestamp()
  where id = p_request_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason,
    responsibility_snapshot
  ) values (
    p_organization_id, p_request_id, p_decision::text, p_actor_id,
    p_operation_id, p_reason,
    jsonb_build_object('responsibility', 'time_approval', 'actorId', p_actor_id)
  );
  if p_decision = 'approved' then
    event_kind := request_record.adjustment_kind::text::public.time_account_event_kind;
    perform app_private.assert_p1_23_period_open(
      p_organization_id, request_record.effective_date
    );
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind,
      effective_date, minutes, reason, adjustment_request_id, operation_id,
      request_hash, created_by
    ) values (
      p_organization_id, request_record.account_id,
      request_record.employee_record_id, event_kind,
      request_record.effective_date, request_record.minutes,
      request_record.reason, request_record.id, gen_random_uuid(),
      request_record.request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = current_balance_minutes + request_record.minutes,
      version = version + 1,
      updated_at = now()
    where id = request_record.account_id;
  end if;
  return p_request_id;
end;
$$;

create or replace function public.close_time_period(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  calculation_record public.time_period_calculations%rowtype;
  close_id uuid := gen_random_uuid();
  close_version integer;
  prior_close_id uuid;
  current_fingerprint text;
  employee_result record;
  account_record public.time_accounts%rowtype;
  close_minutes integer;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into prior_close_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return prior_close_id;
  end if;
  select * into period_record from public.time_periods
  where id = p_period_id and organization_id = p_organization_id for update;
  if not found then raise exception 'period_not_found'; end if;
  if period_record.state = 'closed' then raise exception 'period_closed'; end if;
  if period_record.period_end_date >= (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'period_not_ended'; end if;
  select * into calculation_record from public.time_period_calculations
  where id = period_record.current_calculation_id and organization_id = p_organization_id;
  if not found then raise exception 'period_not_prepared'; end if;
  current_fingerprint := app_private.compute_p1_23_source_fingerprint(
    p_organization_id, period_record.period_start_date, period_record.period_end_date
  );
  if current_fingerprint <> calculation_record.source_fingerprint then raise exception 'stale_calculation'; end if;
  if exists (select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id and finding.severity = 'close_blocked')
    then raise exception 'close_blocked_finding'; end if;
  if exists (select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id and finding.severity = 'approval_required'
      and not exists (select 1 from public.time_period_finding_decisions decision
        where decision.finding_id = finding.id and decision.decision = 'approved'))
    then raise exception 'approval_required_finding'; end if;
  select coalesce(max(version), 0) + 1 into close_version
  from public.time_period_close_versions where period_id = p_period_id;
  insert into public.time_period_close_versions(
    id, organization_id, period_id, calculation_id, version,
    supersedes_close_version_id, source_fingerprint,
    opening_balance_total_minutes, period_delta_total_minutes,
    closing_balance_total_minutes, closed_by
  ) select close_id, p_organization_id, p_period_id, calculation_record.id,
    close_version, period_record.current_close_version_id,
    calculation_record.source_fingerprint,
    coalesce(sum(previous_balance_minutes), 0),
    coalesce(sum(period_delta_minutes), 0),
    coalesce(sum(closing_balance_minutes), 0), p_actor_id
  from public.time_period_employee_results where calculation_id = calculation_record.id;
  for employee_result in
    select * from public.time_period_employee_results
    where calculation_id = calculation_record.id order by employee_record_id
  loop
    select * into account_record from public.time_accounts
    where organization_id = p_organization_id
      and employee_record_id = employee_result.employee_record_id for update;
    if not found then raise exception 'missing_time_account'; end if;
    close_minutes := employee_result.period_delta_minutes - employee_result.account_event_minutes;
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind,
      effective_date, minutes, reason, close_version_id, operation_id,
      request_hash, created_by
    ) values (
      p_organization_id, account_record.id, employee_result.employee_record_id,
      'period_close', period_record.period_end_date, close_minutes,
      'Periodenabschluss ' || period_record.period_start_date::text,
      close_id, gen_random_uuid(), p_request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = employee_result.closing_balance_minutes,
      last_closed_period_end_date = period_record.period_end_date,
      version = version + 1, updated_at = now()
    where id = account_record.id;
  end loop;
  update public.time_periods set state = 'closed', current_close_version_id = close_id,
    version = version + 1, updated_at = now() where id = p_period_id;
  insert into public.time_period_events(
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, event_payload
  ) values (
    p_organization_id, p_period_id, 'closed', calculation_record.id, close_id,
    p_operation_id, p_request_hash, p_actor_id,
    jsonb_build_object('close_version', close_version)
  );
  return close_id;
end;
$$;

create or replace function public.reopen_time_period(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_reason text, p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  close_record public.time_period_close_versions%rowtype;
  close_event record;
  reversal_id uuid;
  account_record public.time_accounts%rowtype;
  previous_closed_period_end date;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into reversal_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return reversal_id;
  end if;
  select * into period_record from public.time_periods
  where id = p_period_id and organization_id = p_organization_id for update;
  if not found or period_record.state <> 'closed' then raise exception 'period_not_closed'; end if;
  select * into close_record from public.time_period_close_versions
  where id = period_record.current_close_version_id;
  select max(other_period.period_end_date) into previous_closed_period_end
  from public.time_periods other_period
  where other_period.organization_id = p_organization_id
    and other_period.id <> p_period_id
    and other_period.state = 'closed';
  for close_event in
    select * from public.time_account_events
    where close_version_id = close_record.id and event_kind = 'period_close'
    order by employee_record_id
  loop
    select * into account_record from public.time_accounts
    where id = close_event.account_id for update;
    reversal_id := gen_random_uuid();
    insert into public.time_account_events(
      id, organization_id, account_id, employee_record_id, event_kind,
      effective_date, minutes, reason, close_version_id, reverses_event_id,
      operation_id, request_hash, created_by
    ) values (
      reversal_id, p_organization_id, close_event.account_id,
      close_event.employee_record_id, 'period_reopen_reversal',
      period_record.period_end_date, -close_event.minutes, p_reason,
      close_record.id, close_event.id, gen_random_uuid(), p_request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = current_balance_minutes - close_event.minutes,
      last_closed_period_end_date = previous_closed_period_end,
      version = version + 1, updated_at = now()
    where id = account_record.id;
  end loop;
  update public.time_periods set state = 'reopened', version = version + 1,
    updated_at = now() where id = p_period_id;
  insert into public.time_period_events(
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, reason
  ) values (
    p_organization_id, p_period_id, 'reopened',
    period_record.current_calculation_id, close_record.id, p_operation_id,
    p_request_hash, p_actor_id, p_reason
  );
  return close_record.id;
end;
$$;

revoke all on function app_private.compute_p1_23_source_fingerprint(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_p1_23_employee_record_actor(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_p1_23_snapshot_relationships()
  from public, anon, authenticated, service_role;
revoke all on function public.get_time_period_source_fingerprint(uuid, uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.decide_time_account_adjustment(
  uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.compute_p1_23_source_fingerprint(uuid, date, date)
  to service_role;
grant execute on function app_private.is_p1_23_employee_record_actor(uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.get_time_period_source_fingerprint(uuid, uuid, date, date)
  to service_role;
grant execute on function public.decide_time_account_adjustment(
  uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid
) to service_role;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text)
  to service_role;
