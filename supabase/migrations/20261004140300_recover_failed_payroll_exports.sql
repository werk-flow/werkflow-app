-- A payroll export that failed or was abandoned no longer blocks the next one.
--
-- 1. A failed export kept its claim on the ready export it meant to replace:
--    payroll_exports_successor_unique covered every row, so after one failure
--    every later reservation of the period failed with a unique violation. The
--    claim now holds only while the export is generating or once it is ready.
-- 2. An export whose generation stopped before it reached a terminal state (a
--    function timeout, a lost connection while it failed) stayed generating.
--    reserve_payroll_export now fails such an export of the same period with
--    the reason generation_abandoned once it has not changed for 15 minutes,
--    longer than any generation runs, before it reserves the new one.
--    generatePayrollExport fails its own export on every refusal after the
--    reservation.

drop index public.payroll_exports_successor_unique;
create unique index payroll_exports_successor_unique on public.payroll_exports (supersedes_export_id)
  where supersedes_export_id is not null and state <> 'failed';

create or replace function public.reserve_payroll_export(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_mapping_version_id uuid,
  p_generator_version text,
  p_content_fingerprint text,
  p_supersedes_export_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
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

  with abandoned as (
    update public.payroll_exports abandoned_export
    set state = 'failed', failure_reason = 'generation_abandoned', updated_at = now()
    where abandoned_export.organization_id = p_organization_id
      and abandoned_export.period_id = p_period_id
      and abandoned_export.state in ('requested', 'generating')
      and abandoned_export.updated_at < now() - interval '15 minutes'
    returning abandoned_export.id
  )
  insert into public.payroll_export_events (organization_id, export_id, event_type, operation_id, actor_id,
    event_payload)
  select p_organization_id, abandoned.id, 'failed', gen_random_uuid(), p_actor_id,
    jsonb_build_object('failure_reason', 'generation_abandoned')
  from abandoned;

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

revoke all on function public.reserve_payroll_export(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_payroll_export(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text)
  to service_role;
