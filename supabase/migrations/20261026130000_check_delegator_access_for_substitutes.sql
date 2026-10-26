-- A substitute holds a responsibility only while the holder who named them
-- has effective personnel access (docs/features/employee-management.md,
-- "Substitutes": the substitute gets exactly that holder's scope). Suspension
-- and access end keep the delegation row, so every function that resolves a
-- delegation checks its delegator. lib/responsibilities/resolution.ts applies
-- the same rule on the server.

create or replace function app_private.employee_record_has_effective_access(
  p_employee_record_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id
      and app_private.p1_24_has_effective_access(employee.organization_id, employee.user_id)
  );
$$;

create or replace function app_private.is_p1_23_time_holder(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  actor_employee_id uuid;
  latest_configuration_id uuid;
  business_date date := (current_timestamp at time zone 'Europe/Berlin')::date;
begin
  if not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    return false;
  end if;

  select employee.id into actor_employee_id
  from public.employee_records employee
  join public.organization_members member
    on member.organization_id = employee.organization_id and member.user_id = employee.user_id
  where employee.organization_id = p_organization_id and employee.user_id = p_actor_id
    and (employee.exit_date is null or employee.exit_date >= business_date);
  if actor_employee_id is null then return false; end if;

  select configuration.id into latest_configuration_id
  from public.organization_responsibility_configurations configuration
  where configuration.organization_id = p_organization_id
    and configuration.responsibility = 'time_approval'
    and configuration.effective_from <= current_timestamp
  order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
  limit 1;

  if latest_configuration_id is null then
    return app_private.is_p1_23_org_manager(p_organization_id, p_actor_id);
  end if;

  if exists (
    select 1 from public.organization_responsibility_assignments assignment
    where assignment.configuration_id = latest_configuration_id
      and assignment.employee_record_id = actor_employee_id
  ) then return true; end if;

  return exists (
    select 1
    from public.organization_responsibility_delegations delegation
    join public.organization_responsibility_assignments base_assignment
      on base_assignment.configuration_id = latest_configuration_id
     and base_assignment.employee_record_id = delegation.delegator_employee_record_id
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'time_approval'
      and delegation.substitute_employee_record_id = actor_employee_id
      and delegation.valid_from <= business_date and delegation.valid_until >= business_date
      and (delegation.revoked_from is null or delegation.revoked_from > business_date)
      and app_private.employee_record_has_effective_access(delegation.delegator_employee_record_id)
  );
end;
$$;

create or replace function app_private.is_time_approval_holder(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_user_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_actor_employee_id uuid;
  v_latest_configuration_id uuid;
  v_direct boolean := false;
  v_role_source public.org_role;
begin
  if p_actor_id = p_target_user_id then return false; end if;
  if not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    return false;
  end if;

  select role into v_actor_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_id;
  select role into v_target_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id;
  select id into v_actor_employee_id
  from public.employee_records
  where organization_id = p_organization_id and user_id = p_actor_id;

  if v_actor_role is null or v_target_role is null or v_actor_employee_id is null then
    return false;
  end if;

  select id into v_latest_configuration_id
  from public.organization_responsibility_configurations
  where organization_id = p_organization_id
    and responsibility = 'time_approval'
    and effective_from <= clock_timestamp()
  order by effective_from desc, created_at desc, id desc
  limit 1;

  if v_latest_configuration_id is null then
    return v_actor_role = 'admin'
      or (v_actor_role = 'buero' and v_target_role = 'employee');
  end if;

  select assignment.source = 'direct', assignment.role_snapshot
    into v_direct, v_role_source
  from public.organization_responsibility_assignments assignment
  where assignment.configuration_id = v_latest_configuration_id
    and assignment.organization_id = p_organization_id
    and assignment.employee_record_id = v_actor_employee_id
  limit 1;

  if found then
    return v_direct or v_role_source = 'admin'
      or (v_role_source = 'buero' and v_target_role = 'employee');
  end if;

  select assignment.source = 'direct', assignment.role_snapshot
    into v_direct, v_role_source
  from public.organization_responsibility_delegations delegation
  join public.organization_responsibility_assignments assignment
    on assignment.organization_id = delegation.organization_id
   and assignment.configuration_id = v_latest_configuration_id
   and assignment.employee_record_id = delegation.delegator_employee_record_id
  where delegation.organization_id = p_organization_id
    and delegation.responsibility = 'time_approval'
    and delegation.substitute_employee_record_id = v_actor_employee_id
    and delegation.valid_from <= current_date
    and delegation.valid_until >= current_date
    and (delegation.revoked_from is null or delegation.revoked_from > current_date)
    and app_private.employee_record_has_effective_access(delegation.delegator_employee_record_id)
  order by delegation.valid_from desc, delegation.id
  limit 1;

  return found and (
    v_direct or v_role_source = 'admin'
    or (v_role_source = 'buero' and v_target_role = 'employee')
  );
end;
$$;

create or replace function app_private.work_handover_actor_can_review(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  with latest_configuration as (
    select configuration.id, configuration.mode
    from public.organization_responsibility_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.responsibility = 'work_handover_review'
      and configuration.effective_from <= now()
    order by configuration.effective_from desc, configuration.created_at desc,
      configuration.id desc
    limit 1
  ), actor as (
    select member.role, employee.id as employee_record_id
    from public.organization_members member
    left join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
     and employee.exit_date is null
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and app_private.p1_24_has_effective_access(p_organization_id, p_actor_id)
  ), directly_authorized as (
    select actor.employee_record_id
    from actor left join latest_configuration configuration on true
    where (
      (configuration.id is null or configuration.mode = 'role_default')
        and actor.role in ('admin', 'buero')
    ) or (
      configuration.mode = 'selected'
      and actor.employee_record_id is not null
      and exists (
        select 1 from public.organization_responsibility_assignments assignment
        where assignment.configuration_id = configuration.id
          and assignment.employee_record_id = actor.employee_record_id
      )
    )
  ), delegated_authorized as (
    select delegation.substitute_employee_record_id
    from public.organization_responsibility_delegations delegation
    join actor on actor.employee_record_id = delegation.substitute_employee_record_id
    left join latest_configuration configuration on true
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'work_handover_review'
      and delegation.valid_from <= (now() at time zone 'Europe/Berlin')::date
      and delegation.valid_until >= (now() at time zone 'Europe/Berlin')::date
      and (delegation.revoked_from is null
        or delegation.revoked_from > (now() at time zone 'Europe/Berlin')::date)
      and app_private.employee_record_has_effective_access(delegation.delegator_employee_record_id)
      and (
        ((configuration.id is null or configuration.mode = 'role_default') and exists (
          select 1
          from public.employee_records delegator
          join public.organization_members member
            on member.organization_id = delegator.organization_id
           and member.user_id = delegator.user_id
          where delegator.id = delegation.delegator_employee_record_id
            and delegator.exit_date is null
            and member.role in ('admin', 'buero')
        ))
        or (configuration.mode = 'selected' and exists (
          select 1 from public.organization_responsibility_assignments assignment
          where assignment.configuration_id = configuration.id
            and assignment.employee_record_id = delegation.delegator_employee_record_id
        ))
      )
  )
  select exists (select 1 from directly_authorized)
    or exists (select 1 from delegated_authorized);
$$;

-- Assignment and own-record helpers: an assignment row or an employee record

create or replace function app_private.work_artifact_actor_can_approve(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  with latest_configuration as (
    select configuration.id, configuration.mode
    from public.organization_responsibility_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.responsibility = 'work_artifact_approval'
      and configuration.effective_from <= now()
    order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
    limit 1
  ), actor as (
    select member.role, employee.id as employee_record_id
    from public.organization_members member
    left join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
     and employee.exit_date is null
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ), directly_authorized as (
    select actor.employee_record_id
    from actor left join latest_configuration configuration on true
    where actor.employee_record_id is not null and (
      ((configuration.id is null or configuration.mode = 'role_default')
        and actor.role in ('admin', 'buero'))
      or (configuration.mode = 'selected' and exists (
        select 1 from public.organization_responsibility_assignments assignment
        where assignment.configuration_id = configuration.id
          and assignment.employee_record_id = actor.employee_record_id
      ))
    )
  ), delegated_authorized as (
    select delegation.substitute_employee_record_id
    from public.organization_responsibility_delegations delegation
    join actor on actor.employee_record_id = delegation.substitute_employee_record_id
    left join latest_configuration configuration on true
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'work_artifact_approval'
      and delegation.valid_from <= (now() at time zone 'Europe/Berlin')::date
      and delegation.valid_until >= (now() at time zone 'Europe/Berlin')::date
      and (delegation.revoked_from is null
        or delegation.revoked_from > (now() at time zone 'Europe/Berlin')::date)
      and app_private.employee_record_has_effective_access(delegation.delegator_employee_record_id)
      and (
        ((configuration.id is null or configuration.mode = 'role_default') and exists (
          select 1
          from public.employee_records delegator
          join public.organization_members member
            on member.organization_id = delegator.organization_id
           and member.user_id = delegator.user_id
          where delegator.id = delegation.delegator_employee_record_id
            and delegator.exit_date is null and member.role in ('admin', 'buero')
        ))
        or (configuration.mode = 'selected' and exists (
          select 1 from public.organization_responsibility_assignments assignment
          where assignment.configuration_id = configuration.id
            and assignment.employee_record_id = delegation.delegator_employee_record_id
        ))
      )
  )
  select exists (select 1 from directly_authorized)
    or exists (select 1 from delegated_authorized);
$$;

create or replace function app_private.get_user_visible_responsibility_configuration_ids(
  p_user_id uuid default auth.uid()
)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct c.id
  from public.organization_responsibility_configurations c
  where c.organization_id in (
    select app_private.get_user_admin_or_manager_org_ids(p_user_id)
  )
  or (
    app_private.p1_24_has_effective_access(c.organization_id, p_user_id)
    and (
      exists (
        select 1
        from public.organization_responsibility_assignments a
        join public.employee_records er on er.id = a.employee_record_id
        where a.configuration_id = c.id and er.user_id = p_user_id
      )
      or exists (
        select 1
        from public.organization_responsibility_delegations d
        join public.employee_records delegator on delegator.id = d.delegator_employee_record_id
        join public.employee_records substitute on substitute.id = d.substitute_employee_record_id
        where d.organization_id = c.organization_id
          and d.responsibility = c.responsibility
          and (
            delegator.user_id = p_user_id
            or (
              substitute.user_id = p_user_id
              and app_private.employee_record_has_effective_access(delegator.id)
            )
          )
      )
    )
  );
$$;

create or replace function app_private.p1_23_time_approval_source(
  p_organization_id uuid, p_actor_id uuid
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  business_date date := (current_timestamp at time zone 'Europe/Berlin')::date;
  latest_configuration_id uuid;
  actor_record_id uuid;
  actor_source text;
begin
  -- A suspended or ended person holds nothing (security.md, "Revocation boundaries").
  if not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    return null;
  end if;

  select employee.id into actor_record_id
  from public.employee_records employee
  join public.organization_members member
    on member.organization_id = employee.organization_id and member.user_id = employee.user_id
  where employee.organization_id = p_organization_id and employee.user_id = p_actor_id
    and (employee.exit_date is null or employee.exit_date > business_date);
  if actor_record_id is null then return null; end if;

  select configuration.id into latest_configuration_id
  from public.organization_responsibility_configurations configuration
  where configuration.organization_id = p_organization_id
    and configuration.responsibility = 'time_approval'
    and configuration.effective_from <= current_timestamp
  order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
  limit 1;

  -- The base source of every active member of the organization.
  with active_member as (
    select employee.id as record_id, member.role
    from public.employee_records employee
    join public.organization_members member
      on member.organization_id = employee.organization_id and member.user_id = employee.user_id
    where employee.organization_id = p_organization_id
      and (employee.exit_date is null or employee.exit_date > business_date)
  ),
  base_source as (
    select active_member.record_id,
      case
        when latest_configuration_id is null then
          case when active_member.role in ('admin', 'buero') then active_member.role::text end
        when assignment.source = 'direct' then 'direct'
        when assignment.source = 'role_default' then assignment.role_snapshot::text
      end as source
    from active_member
    left join public.organization_responsibility_assignments assignment
      on assignment.configuration_id = latest_configuration_id
     and assignment.employee_record_id = active_member.record_id
  ),
  own_source as (
    select base_source.source from base_source
    where base_source.record_id = actor_record_id and base_source.source is not null
  ),
  inherited_source as (
    select base_source.source
    from public.organization_responsibility_delegations delegation
    join base_source
      on base_source.record_id = delegation.delegator_employee_record_id
     and base_source.source is not null
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'time_approval'
      and delegation.substitute_employee_record_id = actor_record_id
      and delegation.valid_from <= business_date and delegation.valid_until >= business_date
      and (delegation.revoked_from is null or delegation.revoked_from > business_date)
      and app_private.employee_record_has_effective_access(delegation.delegator_employee_record_id)
    order by delegation.valid_from desc, delegation.valid_until asc, delegation.id asc
    limit 1
  )
  select coalesce((select source from own_source), (select source from inherited_source))
  into actor_source;
  return actor_source;
end;
$$;
