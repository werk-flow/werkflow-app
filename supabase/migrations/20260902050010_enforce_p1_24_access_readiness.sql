-- A scheduled activation remains pre-start access while an explicit
-- blocks_access requirement is unresolved. Existing memberships without a
-- P1-24 lifecycle keep their deploy-day behavior.

create or replace function app_private.p1_24_effective_access_state(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns public.personnel_access_state
language sql stable security definer set search_path = '' as $$
  select case
    when member.user_id is null then 'ended'::public.personnel_access_state
    when lifecycle.id is null then 'active'::public.personnel_access_state
    when lifecycle.scheduled_for is not null
      and lifecycle.scheduled_for <= p_at
      and lifecycle.scheduled_state = 'active'
      and exists (
        select 1
        from public.personnel_onboarding_requirements requirement
        where requirement.employee_record_id = employee.id
          and requirement.organization_id = p_organization_id
          and requirement.blocks_access
          and requirement.state not in ('fulfilled', 'waived', 'cancelled')
      ) then 'scheduled'::public.personnel_access_state
    when lifecycle.scheduled_for is not null
      and lifecycle.scheduled_for <= p_at
      then lifecycle.scheduled_state
    else lifecycle.state
  end
  from (select p_user_id as user_id) requested
  left join public.organization_members member
    on member.organization_id = p_organization_id
   and member.user_id = requested.user_id
  left join public.employee_records employee
    on employee.organization_id = member.organization_id
   and employee.user_id = member.user_id
  left join public.personnel_access_lifecycles lifecycle
    on lifecycle.employee_record_id = employee.id;
$$;

create or replace function app_private.p1_24_has_prestart_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members member
    join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
    join public.personnel_access_lifecycles lifecycle
      on lifecycle.employee_record_id = employee.id
    where member.organization_id = p_organization_id
      and member.user_id = p_user_id
      and lifecycle.state = 'scheduled'
      and lifecycle.scheduled_state = 'active'
      and (
        lifecycle.scheduled_for > p_at
        or exists (
          select 1
          from public.personnel_onboarding_requirements requirement
          where requirement.employee_record_id = employee.id
            and requirement.organization_id = p_organization_id
            and requirement.blocks_access
            and requirement.state not in ('fulfilled', 'waived', 'cancelled')
        )
      )
  );
$$;

alter function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) rename to set_personnel_access_transition_p1_24_base;

create or replace function public.set_personnel_access_transition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_access_transition_kind,
  p_effective_at timestamptz,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_transition_kind in ('activate_now', 'reactivate') and exists (
    select 1
    from public.personnel_onboarding_requirements requirement
    where requirement.employee_record_id = p_employee_record_id
      and requirement.organization_id = p_organization_id
      and requirement.blocks_access
      and requirement.state not in ('fulfilled', 'waived', 'cancelled')
  ) then
    raise exception 'access_requirements_incomplete';
  end if;
  return public.set_personnel_access_transition_p1_24_base(
    p_actor_id,
    p_organization_id,
    p_employee_record_id,
    p_expected_version,
    p_transition_kind,
    p_effective_at,
    p_reason,
    p_operation_id,
    p_request_hash
  );
end;
$$;

revoke all on function public.set_personnel_access_transition_p1_24_base(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) to service_role;

revoke all on function app_private.p1_24_effective_access_state(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.p1_24_has_prestart_access(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.p1_24_effective_access_state(uuid, uuid, timestamptz)
  to service_role;
grant execute on function app_private.p1_24_has_prestart_access(uuid, uuid, timestamptz)
  to service_role;
