-- Every RLS helper and policy checks effective personnel access, not only the
-- membership role or the assignment row (docs/technical/security.md,
-- "Revocation boundaries"). Suspension and access end keep the membership,
-- the employee record link and the assignments, so a helper that reads them
-- directly keeps serving a person whose access is no longer active. The
-- central helpers moved onto app_private.p1_24_has_effective_access in
-- 20260902042104; this migration moves the remaining ones. A prestart person
-- keeps only the onboarding reads that p1_24_is_self grants explicitly.
-- supabase/tests/security_boundaries.sql fails on a helper or policy that reads
-- organization_members, job_assignments or employee_records without the check.

-- Manager helpers: an Admin or Büro role counts only with effective access.
create or replace function app_private.installed_equipment_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, p_actor_id);
$$;

create or replace function app_private.is_inventory_manager(p_org_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_org_id, p_user_id);
$$;

create or replace function app_private.maintenance_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, p_actor_id);
$$;

create or replace function app_private.service_case_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, p_actor_id);
$$;

create or replace function app_private.is_work_artifact_manager(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, p_user_id);
$$;

create or replace function app_private.is_p1_23_org_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, p_actor_id);
$$;

create or replace function app_private.is_p1_23_org_admin(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_admin(p_organization_id, p_actor_id);
$$;

-- Responsibility holders: the holder needs effective access before any
-- configuration, assignment or delegation counts.
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
-- link counts only with effective access in its organization.
create or replace function app_private.can_access_job_inventory(p_job_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.jobs job
    where job.id = p_job_id
      and app_private.is_inventory_manager(job.organization_id, p_user_id)
  )
  or p_job_id in (select app_private.get_user_assigned_job_ids(p_user_id));
$$;

create or replace function app_private.can_access_work_artifact_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_work_artifact_manager(p_organization_id, p_user_id)
    or (
      app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
      and (
        exists (
          select 1
          from public.job_assignments assignment
          join public.jobs job on job.id = assignment.job_id
          where p_job_id is not null
            and assignment.job_id = p_job_id
            and assignment.user_id = p_user_id
            and job.organization_id = p_organization_id
        )
        or exists (
          select 1
          from public.jobs job
          join public.job_assignments assignment on assignment.job_id = job.id
          where p_project_id is not null
            and job.project_id = p_project_id
            and job.organization_id = p_organization_id
            and assignment.user_id = p_user_id
        )
      )
    );
$$;

create or replace function app_private.can_read_work_handover_root(p_package_id uuid, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.work_handover_packages package
    where package.id = p_package_id
      and (
        app_private.work_handover_actor_can_review(package.organization_id, p_actor_id)
        or (package.job_id is not null
          and package.job_id in (select app_private.get_user_assigned_job_ids(p_actor_id)))
      )
  );
$$;

create or replace function app_private.can_view_work_instruction_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    app_private.p1_24_is_manager(p_organization_id, p_user_id)
    or (
      p_job_id is not null
      and p_project_id is null
      and app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
      and exists (
        select 1
        from public.jobs job
        join public.job_assignments assignment on assignment.job_id = job.id
        where job.id = p_job_id
          and job.organization_id = p_organization_id
          and assignment.user_id = p_user_id
      )
    )
  );
$$;

create or replace function app_private.can_view_p1_14_work_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_instruction_item_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_instruction_item_id is not null then
      app_private.can_view_work_instruction_item(p_instruction_item_id, p_user_id)
    else app_private.can_view_work_instruction_target(
      p_organization_id, p_job_id, p_project_id, p_user_id
    ) or (
      p_project_id is not null
      and p_job_id is null
      and app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
      and exists (
        select 1
        from public.jobs job
        join public.job_assignments assignment on assignment.job_id = job.id
        where job.project_id = p_project_id
          and job.organization_id = p_organization_id
          and assignment.user_id = p_user_id
      )
    )
  end;
$$;

create or replace function app_private.get_user_planning_occurrence_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct a.occurrence_id
  from public.planning_occurrence_assignments a
  join public.employee_records e
    on e.id = a.employee_record_id
   and e.organization_id = a.organization_id
  where e.user_id = (select auth.uid())
    and app_private.p1_24_has_effective_access(e.organization_id, (select auth.uid()));
$$;

-- By the owner's decision a prestart employee does not read their own
-- Zeitkonto: only effective access counts, never prestart access.
create or replace function app_private.is_p1_23_employee_record_actor(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id
      and employee.organization_id = p_organization_id
      and employee.user_id = p_actor_id
  ) and app_private.p1_24_has_effective_access(p_organization_id, p_actor_id);
$$;

create or replace function app_private.get_user_capability_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct ec.capability_id
  from public.employee_capabilities ec
  join public.employee_records er
    on er.id = ec.employee_record_id
   and er.organization_id = ec.organization_id
  where er.user_id = p_user_id
    and app_private.p1_24_has_effective_access(er.organization_id, p_user_id);
$$;

create or replace function app_private.get_user_team_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct tm.team_id
  from public.team_memberships tm
  join public.employee_records er
    on er.id = tm.employee_record_id
   and er.organization_id = tm.organization_id
  where er.user_id = p_user_id
    and app_private.p1_24_has_effective_access(er.organization_id, p_user_id)
    and tm.valid_from <= (now() at time zone 'Europe/Berlin')::date
    and (tm.valid_until is null or tm.valid_until >= (now() at time zone 'Europe/Berlin')::date);
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
          and (delegator.user_id = p_user_id or substitute.user_id = p_user_id)
      )
    )
  );
$$;

-- Policies that read membership, assignment or authorship inline. Each
-- statement only narrows a read for a person without effective access; the
-- server readers already refuse that person, so no build relies on the read.

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "Managers or assigned employees can view maintenance due work"
  on public.maintenance_due_work
  using (
    app_private.maintenance_actor_is_manager(organization_id, (select auth.uid()))
    or job_id in (select app_private.get_user_assigned_job_ids((select auth.uid())))
  );

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "Managers or capturing actors can view work artifact actions"
  on public.work_artifact_actions
  using (
    app_private.is_work_artifact_manager(organization_id, (select auth.uid()))
    or (
      created_by = (select auth.uid())
      and organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    )
    or exists (
      select 1 from public.work_artifacts artifact
      where artifact.id = work_artifact_actions.artifact_id
        and app_private.can_access_work_artifact_target(
          artifact.organization_id, artifact.job_id, artifact.project_id, (select auth.uid())
        )
    )
  );

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "time_account_adjustment_requests_permitted_select"
  on public.time_account_adjustment_requests
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or (
      requested_by = (select auth.uid())
      and organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    )
    or app_private.is_p1_23_employee_record_actor(organization_id, employee_record_id, (select auth.uid()))
  );

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "time_account_adjustment_events_permitted_select"
  on public.time_account_adjustment_events
  using (
    exists (
      select 1 from public.time_account_adjustment_requests request
      where request.id = time_account_adjustment_events.request_id
        and request.organization_id = time_account_adjustment_events.organization_id
        and (
          (
            request.requested_by = (select auth.uid())
            and request.organization_id in (select app_private.get_user_org_ids((select auth.uid())))
          )
          or request.organization_id in (
            select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
          )
          or app_private.is_p1_23_employee_record_actor(
            request.organization_id, request.employee_record_id, (select auth.uid())
          )
        )
    )
  );

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "Admins and managers can view change requests"
  on public.entry_change_requests
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "Members can view closure days"
  on public.organization_closure_days
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "organization_settings_select_for_members"
  on public.organization_settings
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "organization_user_preferences_select_own"
  on public.organization_user_preferences
  using (
    user_id = (select auth.uid())
    and organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  );

-- @destructive: after release 52803322: the server readers already refuse a person without effective access
alter policy "Org members can view co-member profiles"
  on public.profiles
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members subject
      where subject.user_id = profiles.id
        and subject.organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    )
  );
