-- Final P1-23 review hardening. Applied forward because the earlier slice
-- migrations already reached DEV.

create or replace function app_private.assert_p1_23_period_open(
  p_organization_id uuid,
  p_effective_date date
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_organization_id is null or p_effective_date is null then
    raise exception 'invalid_effective_date';
  end if;
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

create or replace function app_private.guard_p1_23_snapshot_relationships()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  parent_employee_id uuid;
  parent_organization_id uuid;
begin
  select result.employee_record_id, result.organization_id
    into parent_employee_id, parent_organization_id
  from public.time_period_employee_results result
  where result.id = new.employee_result_id;
  if parent_organization_id is distinct from new.organization_id then
    raise exception 'invalid_snapshot_parent';
  end if;

  if tg_table_name = 'time_period_daily_results' then
    if parent_employee_id is distinct from new.employee_record_id then
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
  elsif tg_table_name = 'time_period_result_sources'
        and new.daily_result_id is not null
        and not exists (
          select 1 from public.time_period_daily_results daily
          where daily.id = new.daily_result_id
            and daily.employee_result_id = new.employee_result_id
            and daily.organization_id = new.organization_id
        ) then
    raise exception 'invalid_result_source_parent';
  end if;
  return new;
end;
$$;

alter function public.prepare_time_period(
  uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text
) rename to prepare_time_period_p1_23_base;

create function public.prepare_time_period(
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

alter function public.close_time_period(uuid, uuid, uuid, uuid, text)
  rename to close_time_period_p1_23_base;

create function public.close_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_start date;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select period.period_start_date into period_start
  from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if period_start is null then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_start::text, 0
  ));
  return public.close_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_operation_id, p_request_hash
  );
end;
$$;

alter function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text)
  rename to reopen_time_period_p1_23_base;

create function public.reopen_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_start date;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select period.period_start_date into period_start
  from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if period_start is null then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_start::text, 0
  ));
  return public.reopen_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_reason,
    p_operation_id, p_request_hash
  );
end;
$$;

alter function public.create_payroll_mapping_version(
  uuid, uuid, jsonb, jsonb, uuid, text
) rename to create_payroll_mapping_version_p1_23_base;

create function public.create_payroll_mapping_version(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_mappings jsonb,
  p_code_mappings jsonb,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-payroll-mapping', 0
  ));
  return public.create_payroll_mapping_version_p1_23_base(
    p_actor_id, p_organization_id, p_employee_mappings, p_code_mappings,
    p_operation_id, p_request_hash
  );
end;
$$;

alter function public.fail_payroll_export(uuid, uuid, uuid, text, uuid)
  rename to fail_payroll_export_p1_23_base;

create function public.fail_payroll_export(
  p_actor_id uuid,
  p_organization_id uuid,
  p_export_id uuid,
  p_failure_reason text,
  p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(p_failure_reason), '') is null then
    raise exception 'failure_reason_required';
  end if;
  return public.fail_payroll_export_p1_23_base(
    p_actor_id, p_organization_id, p_export_id, p_failure_reason, p_operation_id
  );
end;
$$;

revoke all on function public.prepare_time_period_p1_23_base(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.close_time_period_p1_23_base(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reopen_time_period_p1_23_base(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.create_payroll_mapping_version_p1_23_base(uuid, uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_payroll_export_p1_23_base(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

revoke all on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.create_payroll_mapping_version(uuid, uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_payroll_export(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.prepare_time_period_p1_23_base(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.close_time_period_p1_23_base(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.reopen_time_period_p1_23_base(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.create_payroll_mapping_version_p1_23_base(uuid, uuid, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.fail_payroll_export_p1_23_base(uuid, uuid, uuid, text, uuid) to service_role;

grant execute on function public.prepare_time_period(uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.create_payroll_mapping_version(uuid, uuid, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.fail_payroll_export(uuid, uuid, uuid, text, uuid) to service_role;
