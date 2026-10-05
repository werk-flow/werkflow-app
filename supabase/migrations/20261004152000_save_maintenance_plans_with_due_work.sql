-- Saving a maintenance plan and generating its due work is all or nothing.
-- The server actions createMaintenancePlan, reviseMaintenancePlan and
-- transitionMaintenancePlan in lib/maintenance/actions.ts called the plan
-- function and then generate_maintenance_due_work in a second call, so a
-- refused generation left an active plan without due work. Each action now
-- makes one call, and so one transaction.
--
-- Division of work: the action establishes identity, the active membership and
-- the manager role, and passes the horizon it computed (today in Berlin plus
-- 18 months). The plan functions and the generation repeat the manager check,
-- lock the plan, check its state and raise the action failure code of the
-- first refusal, so nothing changes. A replay with the same idempotency key
-- returns the stored plan through the replay paths of both functions.
--
-- History stays as before: the plan function appends its plan event and the
-- generation appends horizon_extended and one generated event per due item.

-- Generates the due work of a plan that the step before left active, and
-- returns the plan as it is afterwards. It runs as the calling function's
-- owner and no role executes it directly.
create function app_private.generate_due_work_for_active_plan(
  p_plan public.maintenance_plans,
  p_through_date date,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_plans
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_plan public.maintenance_plans%rowtype;
begin
  if p_plan.status <> 'active' then
    return p_plan;
  end if;
  perform public.generate_maintenance_due_work(
    p_plan.organization_id, p_plan.id, p_plan.version, p_through_date, p_actor_id, p_idempotency_key
  );
  select * into strict v_plan from public.maintenance_plans plan
  where plan.id = p_plan.id and plan.organization_id = p_plan.organization_id;
  return v_plan;
end;
$$;

-- Creates a plan with its first revision and, for an active plan, its due
-- work through p_through_date. Refusals are those of create_maintenance_plan
-- and generate_maintenance_due_work.
create function public.create_maintenance_plan_with_due_work(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_revision_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_through_date date
)
returns public.maintenance_plans
language plpgsql
security definer
set search_path to ''
as $$
begin
  return app_private.generate_due_work_for_active_plan(
    public.create_maintenance_plan(
      p_organization_id, p_maintenance_plan_id, p_revision_id, p_payload, p_actor_id, p_idempotency_key
    ),
    p_through_date, p_actor_id, p_idempotency_key
  );
end;
$$;

-- Adds a revision and, for an active plan, regenerates its due work through
-- p_through_date. Refusals are those of revise_maintenance_plan and
-- generate_maintenance_due_work.
create function public.revise_maintenance_plan_with_due_work(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_through_date date
)
returns public.maintenance_plans
language plpgsql
security definer
set search_path to ''
as $$
begin
  return app_private.generate_due_work_for_active_plan(
    public.revise_maintenance_plan(
      p_organization_id, p_maintenance_plan_id, p_revision_id, p_expected_version, p_payload,
      p_reason, p_actor_id, p_idempotency_key
    ),
    p_through_date, p_actor_id, p_idempotency_key
  );
end;
$$;

-- Changes the plan status and, when the plan becomes active, generates its due
-- work through p_through_date. Refusals are those of
-- transition_maintenance_plan and generate_maintenance_due_work.
create function public.transition_maintenance_plan_with_due_work(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_expected_version bigint,
  p_to_status public.maintenance_plan_status,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_through_date date
)
returns public.maintenance_plans
language plpgsql
security definer
set search_path to ''
as $$
begin
  return app_private.generate_due_work_for_active_plan(
    public.transition_maintenance_plan(
      p_organization_id, p_maintenance_plan_id, p_expected_version, p_to_status, p_reason,
      p_actor_id, p_idempotency_key
    ),
    p_through_date, p_actor_id, p_idempotency_key
  );
end;
$$;

revoke all on function app_private.generate_due_work_for_active_plan(public.maintenance_plans, date, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_maintenance_plan_with_due_work(uuid, uuid, uuid, jsonb, uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.revise_maintenance_plan_with_due_work(
  uuid, uuid, uuid, bigint, jsonb, text, uuid, uuid, date
) from public, anon, authenticated;
revoke all on function public.transition_maintenance_plan_with_due_work(
  uuid, uuid, bigint, public.maintenance_plan_status, text, uuid, uuid, date
) from public, anon, authenticated;
grant execute on function public.create_maintenance_plan_with_due_work(uuid, uuid, uuid, jsonb, uuid, uuid, date)
  to service_role;
grant execute on function public.revise_maintenance_plan_with_due_work(
  uuid, uuid, uuid, bigint, jsonb, text, uuid, uuid, date
) to service_role;
grant execute on function public.transition_maintenance_plan_with_due_work(
  uuid, uuid, bigint, public.maintenance_plan_status, text, uuid, uuid, date
) to service_role;
