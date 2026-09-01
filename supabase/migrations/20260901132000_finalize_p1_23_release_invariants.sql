-- P1-23 release invariants found by the final full-diff review.

drop function if exists public.get_time_period_source_fingerprint(uuid, uuid);

revoke all on function public.prepare_time_period_p1_23_base(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from service_role;
revoke all on function public.close_time_period_p1_23_base(uuid, uuid, uuid, uuid, text) from service_role;
revoke all on function public.reopen_time_period_p1_23_base(uuid, uuid, uuid, text, uuid, text) from service_role;
revoke all on function public.create_payroll_mapping_version_p1_23_base(uuid, uuid, jsonb, jsonb, uuid, text) from service_role;
revoke all on function public.fail_payroll_export_p1_23_base(uuid, uuid, uuid, text, uuid) from service_role;

create or replace function app_private.guard_p1_23_opening_event_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_kind = 'opening_balance' then
    perform app_private.assert_p1_23_period_open(new.organization_id, new.effective_date);
  end if;
  return new;
end;
$$;

drop trigger if exists guard_p1_23_opening_event_date on public.time_account_events;
create trigger guard_p1_23_opening_event_date
before insert on public.time_account_events
for each row execute function app_private.guard_p1_23_opening_event_date();

create or replace function app_private.guard_p1_22_correction_application_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fact jsonb;
  fact_timestamp timestamptz;
begin
  if jsonb_typeof(new.before_snapshot->'facts') is distinct from 'array'
     or jsonb_typeof(new.applied_snapshot->'facts') is distinct from 'array' then
    raise exception 'invalid_correction_snapshot';
  end if;
  for fact in
    select value from jsonb_array_elements(new.before_snapshot->'facts')
    union all
    select value from jsonb_array_elements(new.applied_snapshot->'facts')
  loop
    if jsonb_typeof(fact->'timestamp') is distinct from 'string' then
      raise exception 'invalid_correction_fact_timestamp';
    end if;
    fact_timestamp := (fact->>'timestamp')::timestamptz;
    if fact_timestamp is null then
      raise exception 'invalid_correction_fact_timestamp';
    end if;
    perform app_private.assert_p1_23_period_open(
      new.organization_id,
      (fact_timestamp at time zone 'Europe/Berlin')::date
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists guard_p1_22_correction_application_period
  on public.time_correction_applications;
create trigger guard_p1_22_correction_application_period
before insert or update on public.time_correction_applications
for each row execute function app_private.guard_p1_22_correction_application_period();

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
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  if jsonb_typeof(p_employee_results) is distinct from 'array'
     or jsonb_typeof(p_daily_results) is distinct from 'array'
     or jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_typeof(p_findings) is distinct from 'array' then
    raise exception 'invalid_period_payload';
  end if;
  if exists (
    select employee.id
    from public.employee_records employee
    where employee.organization_id = p_organization_id
      and coalesce(employee.entry_date, p_period_start_date) <= p_period_end_date
      and coalesce(employee.exit_date, p_period_end_date) >= p_period_start_date
    except
    select (value->>'employee_record_id')::uuid
    from jsonb_array_elements(p_employee_results)
  ) or exists (
    select (value->>'employee_record_id')::uuid
    from jsonb_array_elements(p_employee_results)
    except
    select employee.id
    from public.employee_records employee
    where employee.organization_id = p_organization_id
      and coalesce(employee.entry_date, p_period_start_date) <= p_period_end_date
      and coalesce(employee.exit_date, p_period_end_date) >= p_period_start_date
  ) then
    raise exception 'incomplete_period_population';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_daily_results) daily
    where not exists (
      select 1 from jsonb_array_elements(p_employee_results) result
      where result->>'id' = daily->>'employee_result_id'
    )
  ) or exists (
    select 1 from jsonb_array_elements(p_sources) source
    where not exists (
      select 1 from jsonb_array_elements(p_employee_results) result
      where result->>'id' = source->>'employee_result_id'
    )
  ) then
    raise exception 'invalid_result_payload_parent';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || p_period_start_date::text, 0
  ));
  return public.prepare_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_start_date, p_period_end_date,
    p_source_fingerprint, p_employee_results, p_daily_results, p_sources,
    p_findings, p_operation_id, p_request_hash
  );
end;
$$;

create or replace function public.close_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select * into period_record from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if not found then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_record.period_start_date::text, 0
  ));
  if exists (
    select 1 from public.time_periods earlier
    where earlier.organization_id = p_organization_id
      and earlier.period_end_date < period_record.period_end_date
      and earlier.state <> 'closed'
  ) or exists (
    select 1 from public.time_periods later
    where later.organization_id = p_organization_id
      and later.period_end_date > period_record.period_end_date
      and later.state = 'closed'
  ) then
    raise exception 'period_order_conflict';
  end if;
  return public.close_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_operation_id, p_request_hash
  );
end;
$$;

create or replace function public.reopen_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select * into period_record from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if not found then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_record.period_start_date::text, 0
  ));
  if exists (
    select 1 from public.time_periods later
    where later.organization_id = p_organization_id
      and later.period_end_date > period_record.period_end_date
      and later.state = 'closed'
  ) then
    raise exception 'period_order_conflict';
  end if;
  return public.reopen_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_reason,
    p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function app_private.guard_p1_23_opening_event_date() from public, anon, authenticated, service_role;
revoke all on function app_private.guard_p1_22_correction_application_period() from public, anon, authenticated, service_role;
revoke all on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) to service_role;
