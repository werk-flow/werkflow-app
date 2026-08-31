create or replace function public.set_maintenance_due_occurrence(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_planning_occurrence_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_before public.maintenance_due_work%rowtype;
  v_after public.maintenance_due_work%rowtype;
  v_payload jsonb := jsonb_build_object(
    'planningOccurrenceId', p_planning_occurrence_id
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(
    p_organization_id, 'due_occurrence_set', p_idempotency_key
  );
  select * into v_existing
  from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'due_occurrence_set'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or v_existing.request_payload <> v_payload then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_after
    from public.maintenance_due_work due_work
    where due_work.id = p_maintenance_due_work_id
      and due_work.organization_id = p_organization_id;
    return v_after;
  end if;

  select * into v_before
  from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id
  for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'maintenance_stale_version';
  end if;
  if v_before.status <> 'visit_created' or v_before.job_id is null then
    raise exception 'maintenance_due_schedule_not_allowed';
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_due_work due_work set
    planning_occurrence_id = p_planning_occurrence_id,
    version = due_work.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);

  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, 'visit_rescheduled',
    p_actor_id, 'Termin geplant', 'due_occurrence_set', p_idempotency_key,
    v_payload, to_jsonb(v_before),
    app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_after;
end;
$$;

revoke all on function public.set_maintenance_due_occurrence(
  uuid, uuid, bigint, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.set_maintenance_due_occurrence(
  uuid, uuid, bigint, uuid, uuid, uuid
) to service_role;
