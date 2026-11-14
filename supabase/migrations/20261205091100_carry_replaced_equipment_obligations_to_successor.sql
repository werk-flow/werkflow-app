-- Replacing an Anlage carries its maintenance obligations and components to
-- the Nachfolger (werk-flow/werkflow-planning#466).
--
-- replace_installed_equipment marked the predecessor replaced and inserted the
-- successor, but the predecessor's plans, their open due work and its child
-- components stayed on the predecessor. The new ten-argument overload takes the
-- manager's reviewed choice per running plan and per component in the same
-- call. A carried plan gets a new revision bound to the successor, and every
-- open and visit-created due item bound to the predecessor moves to that
-- revision with its dates unchanged; completed and closed due work stays on
-- its old revision. A plan
-- left on the predecessor needs a reason. A carried component gets the
-- successor as parent. Each change writes its history in the same call. A
-- choice set that does not match the predecessor's running plans and
-- components, or a stale plan version, refuses the whole replacement.
--
-- Correcting a replacement voids the successor; it now carries the successor's
-- plans and components back to the predecessor first, so no obligation stays
-- on a voided record.
--
-- Expand-only: the nine-argument replace_installed_equipment stays as the bare
-- replacement step for the previous release and for the overload. The new
-- event values are written only by this release; the previous release shows
-- them without a heading.

alter type public.installed_equipment_event_type add value if not exists 'maintenance_plan_carried_over';
alter type public.installed_equipment_event_type add value if not exists 'maintenance_plan_left';
alter type public.installed_equipment_event_type add value if not exists 'component_carried_over';
alter type public.installed_equipment_event_type add value if not exists 'parent_replaced';
alter type public.maintenance_due_event_type add value if not exists 'equipment_replaced';

-- The running plans whose current revision covers the equipment, with their
-- template and the next open due date. The replace dialog lists them, and
-- replace_installed_equipment requires one choice for each.
create function public.list_installed_equipment_replacement_plans(
  p_organization_id uuid,
  p_equipment_id uuid
)
returns table (
  plan_id uuid,
  plan_number text,
  plan_version bigint,
  plan_status public.maintenance_plan_status,
  template_name text,
  next_due_date date
)
language sql stable security invoker set search_path = ''
as $$
  select plan.id, plan.plan_number, plan.version, plan.status, template_version.name,
    (
      select min(due_work.due_date)
      from public.maintenance_due_work due_work
      where due_work.organization_id = plan.organization_id
        and due_work.maintenance_plan_id = plan.id
        and due_work.maintenance_plan_revision_id = plan.current_revision_id
        and due_work.status in ('open', 'visit_created')
    )
  from public.maintenance_plans plan
  join public.maintenance_plan_revision_equipment link
    on link.maintenance_plan_revision_id = plan.current_revision_id
   and link.organization_id = plan.organization_id
   and link.equipment_id = p_equipment_id
  join public.maintenance_plan_revisions revision
    on revision.id = plan.current_revision_id
   and revision.organization_id = plan.organization_id
  join public.work_template_versions template_version
    on template_version.id = revision.template_version_id
   and template_version.organization_id = plan.organization_id
  where plan.organization_id = p_organization_id
    and plan.status in ('draft', 'active', 'suspended')
    and plan.archived_at is null
  order by plan.plan_number, plan.id;
$$;

-- One page of the history of the equipment's predecessors (the Vorgänger, its
-- Vorgänger and so on), newest first.
create function public.list_installed_equipment_predecessor_events(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_offset integer,
  p_limit integer
)
returns setof public.installed_equipment_events
language sql stable security invoker set search_path = ''
as $$
  with recursive chain as (
    select equipment.predecessor_equipment_id as equipment_id, 1 as depth
    from public.installed_equipment equipment
    where equipment.id = p_equipment_id
      and equipment.organization_id = p_organization_id
      and equipment.predecessor_equipment_id is not null
    union all
    select equipment.predecessor_equipment_id, chain.depth + 1
    from public.installed_equipment equipment
    join chain on equipment.id = chain.equipment_id
    where equipment.organization_id = p_organization_id
      and equipment.predecessor_equipment_id is not null
      and chain.depth < 100
  )
  select event.*
  from public.installed_equipment_events event
  join chain on chain.equipment_id = event.equipment_id
  where event.organization_id = p_organization_id
  order by event.effective_at desc, event.recorded_at desc, event.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Moves one plan from one equipment to another. A new revision copies the
-- current one with the equipment swapped. Every open and visit-created due
-- item whose revision covers the old equipment moves onto it with its dates
-- unchanged; that includes items an earlier plan revision left open. When two
-- such items share a cadence date, the one with a visit (else the newer) moves
-- and the other is superseded with a reason, so the date stays due exactly
-- once. Completed and closed due work stays on its revision. A planned-date
-- revision starts one interval after the plan's latest due date, so a later
-- generation recreates no due work of any status; an actual-completion
-- revision starts at the earliest moved date, else at the latest completion's
-- next date. The caller holds the plan's row lock and checked the manager role.
create function app_private.carry_maintenance_plan_to_equipment(
  p_plan public.maintenance_plans,
  p_from_equipment_id uuid,
  p_to_equipment_id uuid,
  p_effective_on date,
  p_reason text,
  p_actor_id uuid,
  p_request_operation text,
  p_idempotency_key uuid
)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_revision public.maintenance_plan_revisions%rowtype;
  v_revision_id uuid := gen_random_uuid();
  v_first_due date;
  v_before jsonb;
  v_due record;
  v_due_before jsonb;
  v_duplicate boolean;
  v_reason text := left(btrim(p_reason), 1000);
  v_payload jsonb := jsonb_build_object(
    'fromEquipmentId', p_from_equipment_id,
    'toEquipmentId', p_to_equipment_id,
    'revisionId', v_revision_id
  );
begin
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = p_plan.current_revision_id
    and revision.organization_id = p_plan.organization_id;
  if v_revision.next_due_basis = 'planned_due_date' then
    select app_private.add_months_clamped(max(due_work.original_due_date), v_revision.interval_months)
    into v_first_due
    from public.maintenance_due_work due_work
    where due_work.organization_id = p_plan.organization_id
      and due_work.maintenance_plan_id = p_plan.id;
  else
    select coalesce(
      min(due_work.original_due_date) filter (where due_work.status in ('open', 'visit_created')),
      max(due_work.next_due_date) filter (where due_work.status = 'completed')
    ) into v_first_due
    from public.maintenance_due_work due_work
    where due_work.organization_id = p_plan.organization_id
      and due_work.maintenance_plan_id = p_plan.id;
  end if;
  v_first_due := coalesce(v_first_due, v_revision.first_due_date);

  v_before := app_private.maintenance_plan_snapshot(p_plan.id, p_plan.organization_id);
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_plan_revisions (
    id, organization_id, maintenance_plan_id, revision_number,
    template_version_id, effective_from_date, first_due_date, interval_months,
    due_window_before_days, due_window_after_days, planned_duration_minutes,
    next_due_basis, operational_instructions, overlap_reason, reason, created_by
  )
  select v_revision_id, p_plan.organization_id, p_plan.id, max(revision.revision_number) + 1,
    v_revision.template_version_id, least(v_first_due, p_effective_on), v_first_due,
    v_revision.interval_months, v_revision.due_window_before_days,
    v_revision.due_window_after_days, v_revision.planned_duration_minutes,
    v_revision.next_due_basis, v_revision.operational_instructions,
    v_revision.overlap_reason, v_reason, p_actor_id
  from public.maintenance_plan_revisions revision
  where revision.maintenance_plan_id = p_plan.id
    and revision.organization_id = p_plan.organization_id;
  insert into public.maintenance_plan_revision_equipment (
    organization_id, maintenance_plan_revision_id, equipment_id, created_by
  )
  select distinct p_plan.organization_id, v_revision_id,
    case when link.equipment_id = p_from_equipment_id then p_to_equipment_id else link.equipment_id end,
    p_actor_id
  from public.maintenance_plan_revision_equipment link
  where link.maintenance_plan_revision_id = v_revision.id
    and link.organization_id = p_plan.organization_id;
  update public.maintenance_plans plan set
    current_revision_id = v_revision_id,
    version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_plan.id and plan.organization_id = p_plan.organization_id;

  for v_due in
    select due_work.id, due_work.original_due_date
    from public.maintenance_due_work due_work
    join public.maintenance_plan_revision_equipment link
      on link.maintenance_plan_revision_id = due_work.maintenance_plan_revision_id
     and link.organization_id = due_work.organization_id
     and link.equipment_id = p_from_equipment_id
    where due_work.organization_id = p_plan.organization_id
      and due_work.maintenance_plan_id = p_plan.id
      and due_work.status in ('open', 'visit_created')
    order by due_work.status = 'visit_created' desc, due_work.created_at desc, due_work.id
    for update of due_work
  loop
    v_due_before := app_private.maintenance_due_snapshot(v_due.id, p_plan.organization_id);
    v_duplicate := exists (
      select 1 from public.maintenance_due_work moved
      where moved.organization_id = p_plan.organization_id
        and moved.maintenance_plan_id = p_plan.id
        and moved.maintenance_plan_revision_id = v_revision_id
        and moved.original_due_date = v_due.original_due_date
    );
    perform set_config('app.maintenance_write', 'true', true);
    if v_duplicate then
      update public.maintenance_due_work due_work set
        status = 'superseded',
        exception_reason = 'Beim Anlagentausch mit der gleichen Fälligkeit zusammengeführt',
        version = due_work.version + 1, updated_by = p_actor_id, updated_at = now()
      where due_work.id = v_due.id and due_work.organization_id = p_plan.organization_id;
    else
      update public.maintenance_due_work due_work set
        maintenance_plan_revision_id = v_revision_id,
        version = due_work.version + 1, updated_by = p_actor_id, updated_at = now()
      where due_work.id = v_due.id and due_work.organization_id = p_plan.organization_id;
    end if;
    perform set_config('app.maintenance_write', 'false', true);
    perform app_private.record_maintenance_due_event(
      p_plan.organization_id, v_due.id,
      case when v_duplicate then 'superseded' else 'equipment_replaced' end::public.maintenance_due_event_type,
      p_actor_id, v_reason, p_request_operation,
      md5(p_idempotency_key::text || ':' || v_due.id::text)::uuid,
      v_payload, v_due_before,
      app_private.maintenance_due_snapshot(v_due.id, p_plan.organization_id)
    );
  end loop;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_plan_event(
    p_plan.organization_id, p_plan.id, 'revised', p_actor_id, v_reason,
    p_request_operation, md5(p_idempotency_key::text || ':' || p_plan.id::text)::uuid,
    v_payload, v_before,
    app_private.maintenance_plan_snapshot(p_plan.id, p_plan.organization_id)
  );
end;
$$;

-- Records one equipment event that names a plan or a component it concerns.
-- The state does not change; the subject lands beside the equipment snapshot.
-- The caller checked the manager role.
create function app_private.record_installed_equipment_subject_event(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_event_type public.installed_equipment_event_type,
  p_subject jsonb,
  p_effective_at timestamptz,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid
)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_snapshot jsonb := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  v_state public.installed_equipment_state := (v_snapshot->>'state')::public.installed_equipment_state;
begin
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, p_event_type, v_state, v_state,
    p_effective_at, p_actor_id, p_reason, p_request_operation, p_idempotency_key,
    null, v_snapshot, v_snapshot || jsonb_build_object('subject', p_subject)
  );
end;
$$;

-- Replaces an Anlage with its plans and components handled by the manager's
-- choice. p_carry_over is {"plans": [{"planId", "expectedVersion", "carry",
-- "reason"}], "components": [{"equipmentId", "carry"}]} and names every
-- running plan of the predecessor and every component below it, exactly once.
-- Refusals: those of the nine-argument replacement;
-- 'installed_equipment_stale_version' for a choice set that does not match or
-- a stale plan version; 'installed_equipment_replacement_plan_reason_required'
-- for a plan left without a reason; 'maintenance_template_version_unavailable'
-- when a carried plan's template version is no longer published.
create function public.replace_installed_equipment(
  p_organization_id uuid,
  p_predecessor_id uuid,
  p_successor_id uuid,
  p_expected_version bigint,
  p_successor_payload jsonb,
  p_effective_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_carry_over jsonb
)
returns public.installed_equipment
language plpgsql security invoker set search_path = ''
as $$
declare
  v_successor public.installed_equipment%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_choice record;
  v_component public.installed_equipment%rowtype;
  v_component_before jsonb;
  v_effective_on date := (p_effective_at at time zone 'Europe/Berlin')::date;
  v_plan_subject jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_predecessor_id
      and event.request_operation = 'replace'
      and event.idempotency_key = p_idempotency_key
  ) then
    return public.replace_installed_equipment(
      p_organization_id, p_predecessor_id, p_successor_id, p_expected_version,
      p_successor_payload, p_effective_at, p_reason, p_actor_id, p_idempotency_key
    );
  end if;
  if jsonb_typeof(p_carry_over->'plans') is distinct from 'array'
     or jsonb_typeof(p_carry_over->'components') is distinct from 'array' then
    raise exception 'installed_equipment_stale_version';
  end if;

  v_successor := public.replace_installed_equipment(
    p_organization_id, p_predecessor_id, p_successor_id, p_expected_version,
    p_successor_payload, p_effective_at, p_reason, p_actor_id, p_idempotency_key
  );

  -- The choices name exactly the running plans and the components below the
  -- predecessor, each once.
  if exists (
    select choice."planId" from jsonb_to_recordset(p_carry_over->'plans') as choice("planId" uuid)
    group by choice."planId" having count(*) > 1
  ) or exists (
    select choice."equipmentId" from jsonb_to_recordset(p_carry_over->'components') as choice("equipmentId" uuid)
    group by choice."equipmentId" having count(*) > 1
  ) or exists (
    (
      select choice."planId" from jsonb_to_recordset(p_carry_over->'plans') as choice("planId" uuid)
      except
      select running.plan_id
      from public.list_installed_equipment_replacement_plans(p_organization_id, p_predecessor_id) running
    ) union all (
      select running.plan_id
      from public.list_installed_equipment_replacement_plans(p_organization_id, p_predecessor_id) running
      except
      select choice."planId" from jsonb_to_recordset(p_carry_over->'plans') as choice("planId" uuid)
    )
  ) or exists (
    (
      select choice."equipmentId"
      from jsonb_to_recordset(p_carry_over->'components') as choice("equipmentId" uuid)
      except
      select component.id from public.installed_equipment component
      where component.organization_id = p_organization_id
        and component.parent_equipment_id = p_predecessor_id
        and component.voided_at is null and component.archived_at is null
        and component.state not in ('replaced', 'decommissioned')
    ) union all (
      select component.id from public.installed_equipment component
      where component.organization_id = p_organization_id
        and component.parent_equipment_id = p_predecessor_id
        and component.voided_at is null and component.archived_at is null
        and component.state not in ('replaced', 'decommissioned')
      except
      select choice."equipmentId"
      from jsonb_to_recordset(p_carry_over->'components') as choice("equipmentId" uuid)
    )
  ) then
    raise exception 'installed_equipment_stale_version';
  end if;

  for v_choice in
    select choice."planId" as plan_id, choice."expectedVersion" as expected_version,
      coalesce(choice.carry, true) as carry, nullif(btrim(choice.reason), '') as reason
    from jsonb_to_recordset(p_carry_over->'plans')
      as choice("planId" uuid, "expectedVersion" bigint, carry boolean, reason text)
    order by choice."planId"
  loop
    select * into v_plan from public.maintenance_plans plan
    where plan.id = v_choice.plan_id and plan.organization_id = p_organization_id
    for update;
    if v_plan.version is distinct from v_choice.expected_version then
      raise exception 'installed_equipment_stale_version';
    end if;
    v_plan_subject := jsonb_build_object(
      'maintenancePlanId', v_plan.id, 'maintenancePlanNumber', v_plan.plan_number
    );
    if v_choice.carry then
      perform app_private.carry_maintenance_plan_to_equipment(
        v_plan, p_predecessor_id, p_successor_id, v_effective_on,
        'Anlagentausch: ' || btrim(p_reason), p_actor_id, 'equipment_replace', p_idempotency_key
      );
      perform app_private.record_installed_equipment_subject_event(
        p_organization_id, p_predecessor_id, 'maintenance_plan_carried_over', v_plan_subject,
        p_effective_at, p_actor_id, p_reason, 'replace',
        md5(p_idempotency_key::text || ':' || v_plan.id::text)::uuid
      );
      perform app_private.record_installed_equipment_subject_event(
        p_organization_id, p_successor_id, 'maintenance_plan_carried_over', v_plan_subject,
        p_effective_at, p_actor_id, p_reason, 'replace',
        md5(p_idempotency_key::text || ':' || v_plan.id::text)::uuid
      );
    else
      if length(coalesce(v_choice.reason, '')) not between 3 and 1000 then
        raise exception 'installed_equipment_replacement_plan_reason_required';
      end if;
      perform app_private.record_installed_equipment_subject_event(
        p_organization_id, p_predecessor_id, 'maintenance_plan_left', v_plan_subject,
        p_effective_at, p_actor_id, v_choice.reason, 'replace',
        md5(p_idempotency_key::text || ':' || v_plan.id::text)::uuid
      );
    end if;
  end loop;

  for v_component in
    select component.* from public.installed_equipment component
    join jsonb_to_recordset(p_carry_over->'components') as choice("equipmentId" uuid, carry boolean)
      on choice."equipmentId" = component.id
    where component.organization_id = p_organization_id and coalesce(choice.carry, true)
    order by component.id
    for update of component
  loop
    v_component_before := app_private.installed_equipment_snapshot(v_component.id, p_organization_id);
    perform set_config('app.installed_equipment_write', 'true', true);
    update public.installed_equipment component set
      parent_equipment_id = p_successor_id,
      version = component.version + 1, updated_by = p_actor_id, updated_at = now()
    where component.id = v_component.id and component.organization_id = p_organization_id;
    perform set_config('app.installed_equipment_write', 'false', true);
    perform app_private.record_installed_equipment_event(
      p_organization_id, v_component.id, 'parent_replaced', v_component.state, v_component.state,
      p_effective_at, p_actor_id, p_reason, 'replace', p_idempotency_key, null,
      v_component_before, app_private.installed_equipment_snapshot(v_component.id, p_organization_id)
    );
    perform app_private.record_installed_equipment_subject_event(
      p_organization_id, p_successor_id, 'component_carried_over',
      jsonb_build_object('componentId', v_component.id, 'componentNumber', v_component.equipment_number),
      p_effective_at, p_actor_id, p_reason, 'replace',
      md5(p_idempotency_key::text || ':' || v_component.id::text)::uuid
    );
  end loop;

  select * into strict v_successor from public.installed_equipment equipment
  where equipment.id = p_successor_id and equipment.organization_id = p_organization_id;
  return v_successor;
end;
$$;

-- As before, and a replacement's successor hands its running plans and its
-- components back to the predecessor before it is voided.
create or replace function public.correct_installed_equipment_terminal_action(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_corrects_event_id uuid,
  p_effective_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_corrected public.installed_equipment_events%rowtype;
  v_successor public.installed_equipment%rowtype;
  v_successor_registration public.installed_equipment_events%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_component public.installed_equipment%rowtype;
  v_component_before jsonb;
  v_before jsonb;
  v_after jsonb;
  v_successor_before jsonb;
  v_successor_after jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'correct_terminal'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.archived_at is not null then raise exception 'installed_equipment_archived'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  select * into v_corrected from public.installed_equipment_events event
  where event.id = p_corrects_event_id
    and event.organization_id = p_organization_id
    and event.equipment_id = p_equipment_id
    and event.event_type in ('replaced', 'decommissioned')
    and event.to_state = v_equipment.state;
  if not found or v_corrected.from_state is null then
    raise exception 'installed_equipment_correction_target_invalid';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;
  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  if v_equipment.state = 'replaced' then
    select * into v_successor from public.installed_equipment successor
    where successor.organization_id = p_organization_id
      and successor.predecessor_equipment_id = p_equipment_id
      and successor.voided_at is null
    for update;
    if not found then raise exception 'installed_equipment_successor_not_found'; end if;
    select * into v_successor_registration
    from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = v_successor.id
      and event.event_type = 'registered'
      and event.request_operation = 'replace'
      and event.idempotency_key = v_corrected.idempotency_key;
    if not found then raise exception 'installed_equipment_successor_origin_invalid'; end if;

    for v_plan in
      select plan.* from public.maintenance_plans plan
      where plan.id in (
        select running.plan_id
        from public.list_installed_equipment_replacement_plans(p_organization_id, v_successor.id) running
      ) and plan.organization_id = p_organization_id
      order by plan.id
      for update
    loop
      perform app_private.carry_maintenance_plan_to_equipment(
        v_plan, v_successor.id, p_equipment_id,
        (p_effective_at at time zone 'Europe/Berlin')::date,
        'Korrektur des Anlagentauschs: ' || btrim(p_reason), p_actor_id,
        'equipment_replace_correct', p_idempotency_key
      );
    end loop;
    for v_component in
      select component.* from public.installed_equipment component
      where component.organization_id = p_organization_id
        and component.parent_equipment_id = v_successor.id
        and component.voided_at is null
      order by component.id
      for update
    loop
      v_component_before := app_private.installed_equipment_snapshot(v_component.id, p_organization_id);
      perform set_config('app.installed_equipment_write', 'true', true);
      update public.installed_equipment component set
        parent_equipment_id = p_equipment_id,
        version = component.version + 1, updated_by = p_actor_id, updated_at = now()
      where component.id = v_component.id and component.organization_id = p_organization_id;
      perform set_config('app.installed_equipment_write', 'false', true);
      perform app_private.record_installed_equipment_event(
        p_organization_id, v_component.id, 'parent_replaced', v_component.state, v_component.state,
        p_effective_at, p_actor_id, p_reason, 'correct_terminal', p_idempotency_key, null,
        v_component_before, app_private.installed_equipment_snapshot(v_component.id, p_organization_id)
      );
    end loop;

    v_successor_before := app_private.installed_equipment_snapshot(
      v_successor.id, p_organization_id
    );
    perform set_config('app.installed_equipment_write', 'true', true);
    update public.installed_equipment successor set
      voided_at = now(),
      voided_by = p_actor_id,
      void_reason = btrim(p_reason),
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
    where successor.id = v_successor.id;
    v_successor_after := app_private.installed_equipment_snapshot(
      v_successor.id, p_organization_id
    );
  end if;
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    state = v_corrected.from_state,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, 'terminal_action_corrected',
    v_equipment.state, v_corrected.from_state, p_effective_at, p_actor_id,
    p_reason, 'correct_terminal', p_idempotency_key, p_corrects_event_id,
    v_before, v_after
  );
  if v_successor.id is not null then
    perform app_private.record_installed_equipment_event(
      p_organization_id, v_successor.id, 'terminal_action_corrected',
      v_successor.state, v_successor.state, p_effective_at, p_actor_id,
      p_reason, 'correct_terminal', p_idempotency_key,
      v_successor_registration.id,
      v_successor_before, v_successor_after
    );
  end if;
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

revoke all on function app_private.carry_maintenance_plan_to_equipment(
  public.maintenance_plans, uuid, uuid, date, text, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function app_private.record_installed_equipment_subject_event(
  uuid, uuid, public.installed_equipment_event_type, jsonb, timestamptz, uuid, text, text, uuid
) from public, anon, authenticated;
-- The invoker replacement runs these as service_role.
grant execute on function app_private.carry_maintenance_plan_to_equipment(
  public.maintenance_plans, uuid, uuid, date, text, uuid, text, uuid
) to service_role;
grant execute on function app_private.record_installed_equipment_subject_event(
  uuid, uuid, public.installed_equipment_event_type, jsonb, timestamptz, uuid, text, text, uuid
) to service_role;
revoke all on function public.list_installed_equipment_replacement_plans(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_installed_equipment_predecessor_events(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.replace_installed_equipment(
  uuid, uuid, uuid, bigint, jsonb, timestamptz, text, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.list_installed_equipment_replacement_plans(uuid, uuid) to service_role;
grant execute on function public.list_installed_equipment_predecessor_events(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.replace_installed_equipment(
  uuid, uuid, uuid, bigint, jsonb, timestamptz, text, uuid, uuid, jsonb
) to service_role;
