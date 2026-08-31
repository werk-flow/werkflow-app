create or replace function app_private.validate_maintenance_plan_initial_status()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status not in ('draft', 'active') then
    raise exception 'maintenance_plan_initial_status_invalid';
  end if;
  return new;
end;
$$;

create trigger maintenance_plans_validate_initial_status
before insert on public.maintenance_plans
for each row execute function app_private.validate_maintenance_plan_initial_status();

revoke all on function app_private.validate_maintenance_plan_initial_status()
from public, anon, authenticated;
grant execute on function app_private.validate_maintenance_plan_initial_status()
to service_role;

create or replace function public.link_maintenance_due_visit(
  p_organization_id uuid,
  p_maintenance_due_work_ids uuid[],
  p_job_id uuid,
  p_planning_occurrence_id uuid,
  p_expected_versions bigint[],
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns setof public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_due_id uuid;
  v_expected bigint;
  v_before jsonb;
  v_after public.maintenance_due_work%rowtype;
  v_existing_count integer;
  v_matching_count integer;
  v_previous_maintenance_write text := current_setting('app.maintenance_write', true);
  v_payload jsonb := jsonb_build_object(
    'jobId', p_job_id,
    'planningOccurrenceId', p_planning_occurrence_id
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(
    p_organization_id, 'due_visit_link', p_idempotency_key
  );
  if p_maintenance_due_work_ids is null
     or p_expected_versions is null
     or cardinality(p_maintenance_due_work_ids) not between 1 and 20
     or cardinality(p_maintenance_due_work_ids) <> cardinality(p_expected_versions)
     or array_position(p_maintenance_due_work_ids, null) is not null
     or array_position(p_expected_versions, null) is not null
     or (
       select count(distinct value)
       from unnest(p_maintenance_due_work_ids) as input(value)
     ) <> cardinality(p_maintenance_due_work_ids) then
    raise exception 'maintenance_due_batch_invalid';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_reason_required';
  end if;

  select
    count(*),
    count(*) filter (
      where event.maintenance_due_work_id = any(p_maintenance_due_work_ids)
        and event.request_payload = v_payload
    )
  into v_existing_count, v_matching_count
  from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id
    and event.idempotency_key = p_idempotency_key
    and event.request_operation like 'due_visit_link:%';

  if v_existing_count > 0 then
    if v_existing_count <> cardinality(p_maintenance_due_work_ids)
       or v_matching_count <> cardinality(p_maintenance_due_work_ids) then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    if (
      select count(*)
      from unnest(p_maintenance_due_work_ids) as requested(id)
      join public.maintenance_due_work due_work
        on due_work.id = requested.id
       and due_work.organization_id = p_organization_id
    ) <> cardinality(p_maintenance_due_work_ids) then
      raise exception 'maintenance_due_not_found';
    end if;
    return query
      select due_work.*
      from unnest(p_maintenance_due_work_ids) with ordinality as requested(id, ordinal)
      join public.maintenance_due_work due_work
        on due_work.id = requested.id
       and due_work.organization_id = p_organization_id
      order by requested.ordinal;
    return;
  end if;

  if (
    select count(*)
    from public.maintenance_due_work due_work
    where due_work.organization_id = p_organization_id
      and due_work.id = any(p_maintenance_due_work_ids)
  ) <> cardinality(p_maintenance_due_work_ids) then
    raise exception 'maintenance_due_not_found';
  end if;
  perform due_work.id
  from public.maintenance_due_work due_work
  where due_work.organization_id = p_organization_id
    and due_work.id = any(p_maintenance_due_work_ids)
  order by due_work.id
  for update;

  for v_index in 1..cardinality(p_maintenance_due_work_ids) loop
    v_due_id := p_maintenance_due_work_ids[v_index];
    v_expected := p_expected_versions[v_index];
    select app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    into v_before;
    if (v_before->>'version')::bigint <> v_expected then
      raise exception 'maintenance_stale_version';
    end if;
    if (v_before->>'status') <> 'open' then
      raise exception 'maintenance_due_visit_not_allowed';
    end if;
    perform set_config('app.maintenance_write', 'true', true);
    update public.maintenance_due_work due_work set
      job_id = p_job_id,
      planning_occurrence_id = p_planning_occurrence_id,
      status = 'visit_created',
      version = due_work.version + 1,
      updated_by = p_actor_id,
      updated_at = now()
    where due_work.id = v_due_id
      and due_work.organization_id = p_organization_id
      and due_work.version = v_expected
    returning * into v_after;
    if not found then raise exception 'maintenance_stale_version'; end if;
    perform set_config(
      'app.maintenance_write',
      coalesce(nullif(v_previous_maintenance_write, ''), 'false'),
      true
    );
    perform app_private.record_maintenance_due_event(
      p_organization_id,
      v_due_id,
      case
        when v_index = 1 then 'visit_linked'::public.maintenance_due_event_type
        else 'combined'
      end,
      p_actor_id,
      p_reason,
      'due_visit_link:' || v_due_id::text,
      p_idempotency_key,
      v_payload,
      v_before,
      app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    );
    return next v_after;
  end loop;
end;
$$;
