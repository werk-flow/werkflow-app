-- Maintenance due work generation had no bound on its loop.
--
-- generate_maintenance_due_work walks a planned_due_date plan from its first
-- due date to the horizon one interval at a time and creates a due item and
-- its event for every date from the effective date on. A first due date
-- centuries back created tens of thousands of rows in one transaction.
--
-- maintenancePlanSchema (lib/maintenance/validation.ts) now refuses a first
-- due date more than five years before today, which bounds a new or revised
-- plan. The function caps the walk at 600 steps, fifty years of a monthly
-- plan, and refuses with 'maintenance_generation_horizon_invalid' beyond it,
-- so a plan the schema did not bound cannot run away either. Every DEV plan
-- stays far below the cap.
--
-- The signature, the result, the other refusals and the grants stay as before.

create or replace function public.generate_maintenance_due_work(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_expected_version bigint,
  p_through_date date,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns setof public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_revision public.maintenance_plan_revisions%rowtype;
  v_due_date date;
  v_due_id uuid;
  v_before_snapshot jsonb;
  v_today date := (timezone('Europe/Berlin', now()))::date;
  v_payload jsonb := jsonb_build_object('throughDate', p_through_date);
  v_steps integer := 0;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_generate', p_idempotency_key);
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_generate'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    return query select due_work.* from public.maintenance_due_work due_work
    where due_work.maintenance_plan_id = p_maintenance_plan_id
      and due_work.organization_id = p_organization_id and due_work.due_date <= p_through_date
    order by due_work.due_date, due_work.id;
    return;
  end if;
  select * into v_plan from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_plan_not_found'; end if;
  if v_plan.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_plan.status <> 'active' or v_plan.archived_at is not null then raise exception 'maintenance_plan_generation_not_allowed'; end if;
  if p_through_date < v_today or p_through_date > v_today + interval '18 months' then
    raise exception 'maintenance_generation_horizon_invalid';
  end if;
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = v_plan.current_revision_id and revision.organization_id = p_organization_id;
  v_before_snapshot := app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id);

  if v_revision.next_due_basis = 'planned_due_date' then
    v_due_date := v_revision.first_due_date;
    while v_due_date <= p_through_date loop
      v_steps := v_steps + 1;
      if v_steps > 600 then raise exception 'maintenance_generation_horizon_invalid'; end if;
      if v_due_date >= v_revision.effective_from_date then
        v_due_id := gen_random_uuid();
        perform set_config('app.maintenance_write', 'true', true);
        insert into public.maintenance_due_work (
          id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
          original_due_date, due_date, window_start_date, window_end_date,
          created_by, updated_by
        ) values (
          v_due_id, p_organization_id, p_maintenance_plan_id, v_revision.id,
          v_due_date, v_due_date,
          v_due_date - v_revision.due_window_before_days,
          v_due_date + v_revision.due_window_after_days,
          p_actor_id, p_actor_id
        ) on conflict (maintenance_plan_id, maintenance_plan_revision_id, original_due_date)
          do nothing returning id into v_due_id;
        perform set_config('app.maintenance_write', 'false', true);
        if v_due_id is not null then
          perform app_private.record_maintenance_due_event(
            p_organization_id, v_due_id, 'generated', p_actor_id, null,
            'due_generated', v_due_id, jsonb_build_object('dueDate', v_due_date),
            null, app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
          );
        end if;
      end if;
      v_due_date := app_private.add_months_clamped(v_due_date, v_revision.interval_months);
    end loop;
  elsif not exists (
    select 1 from public.maintenance_due_work due_work
    where due_work.maintenance_plan_id = p_maintenance_plan_id
      and due_work.maintenance_plan_revision_id = v_revision.id
  ) and v_revision.first_due_date <= p_through_date then
    v_due_id := gen_random_uuid();
    perform set_config('app.maintenance_write', 'true', true);
    insert into public.maintenance_due_work (
      id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
      original_due_date, due_date, window_start_date, window_end_date,
      created_by, updated_by
    ) values (
      v_due_id, p_organization_id, p_maintenance_plan_id, v_revision.id,
      v_revision.first_due_date, v_revision.first_due_date,
      v_revision.first_due_date - v_revision.due_window_before_days,
      v_revision.first_due_date + v_revision.due_window_after_days,
      p_actor_id, p_actor_id
    );
    perform set_config('app.maintenance_write', 'false', true);
    perform app_private.record_maintenance_due_event(
      p_organization_id, v_due_id, 'generated', p_actor_id, null,
      'due_generated', v_due_id, jsonb_build_object('dueDate', v_revision.first_due_date),
      null, app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    );
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_plans plan set generation_through_date = greatest(
      coalesce(plan.generation_through_date, p_through_date), p_through_date
    ), version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id, 'horizon_extended', p_actor_id, null,
    'plan_generate', p_idempotency_key, v_payload, v_before_snapshot,
    app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return query select due_work.* from public.maintenance_due_work due_work
  where due_work.maintenance_plan_id = p_maintenance_plan_id
    and due_work.organization_id = p_organization_id and due_work.due_date <= p_through_date
  order by due_work.due_date, due_work.id;
end;
$$;
