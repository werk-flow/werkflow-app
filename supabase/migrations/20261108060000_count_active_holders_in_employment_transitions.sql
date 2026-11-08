-- An employment transition to inactive or exited refuses to leave a selected
-- responsibility group without an active holder. It counted every listed
-- holder, so a holder who had already exited or left the organization still
-- counted as the remaining one, and it took no lock. It now counts as the
-- last-holder check on a member removal does: another listed holder who is a
-- member of the organization and whose personnel record has no exit date.
--
-- It takes the organization's responsibility holder lock
-- (20261108010000_serialize_responsibility_holder_changes_per_organization.sql)
-- before it reads the configuration, so it serializes with the owner's save,
-- member removals and role-default snapshots, and two transitions of the last
-- two holders cannot each count the other. Its read compares effective_from
-- with clock_timestamp() and runs as a new statement after the wait, so it sees
-- what committed meanwhile. Lock order stays: the organization lock before
-- the personnel record, which the transition writes after the check. Before
-- the lock it holds only its own per-person lock and lifecycle row, which no
-- holder of the organization lock takes.
--
-- The signature, the other checks, the result and the grants stay as before
-- (20260902042103_add_p1_24_people_lifecycle_rpcs.sql).

create or replace function public.set_personnel_employment_transition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_employment_transition_kind,
  p_effective_on date,
  p_reason text,
  p_unresolved_work jsonb,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  lifecycle public.personnel_employment_lifecycles;
  employee public.employee_records;
  baseline_state public.personnel_employment_state;
  target_state public.personnel_employment_state;
  result_id uuid;
  new_version bigint;
  has_stranded_responsibility boolean;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if p_effective_on is null or nullif(btrim(p_reason), '') is null
     or jsonb_typeof(coalesce(p_unresolved_work, '[]'::jsonb)) <> 'array'
  then raise exception 'invalid_transition'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-employment:' || p_employee_record_id::text, 0
  ));
  select * into employee from public.employee_records
  where id = p_employee_record_id and organization_id = p_organization_id;
  if employee.id is null then raise exception 'employee_record_not_found'; end if;
  select * into lifecycle from public.personnel_employment_lifecycles
  where employee_record_id = p_employee_record_id for update;

  if lifecycle.id is not null and lifecycle.scheduled_for is not null
     and lifecycle.scheduled_for <= (clock_timestamp() at time zone 'Europe/Berlin')::date then
    update public.personnel_employment_lifecycles set
      state = scheduled_state,
      state_effective_on = scheduled_for,
      scheduled_state = null,
      scheduled_for = null
    where id = lifecycle.id returning * into lifecycle;
  end if;
  if lifecycle.id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    baseline_state := case
      when employee.entry_date is not null and employee.entry_date > (clock_timestamp() at time zone 'Europe/Berlin')::date then 'planned'
      when employee.exit_date is not null and employee.exit_date <= (clock_timestamp() at time zone 'Europe/Berlin')::date then 'exited'
      else 'active'
    end;
  else
    if p_expected_version is distinct from lifecycle.version then raise exception 'stale_version'; end if;
    baseline_state := lifecycle.state;
  end if;

  target_state := case p_transition_kind
    when 'plan_start' then 'active'::public.personnel_employment_state
    when 'start' then 'active'::public.personnel_employment_state
    when 'record_notice' then 'notice'::public.personnel_employment_state
    when 'plan_exit' then 'exited'::public.personnel_employment_state
    when 'mark_inactive' then 'inactive'::public.personnel_employment_state
    when 'exit' then 'exited'::public.personnel_employment_state
    when 'reverse' then 'active'::public.personnel_employment_state
    when 'reactivate' then 'active'::public.personnel_employment_state
    when 'cancel_scheduled' then baseline_state
  end;
  if p_transition_kind = 'cancel_scheduled'
     and (lifecycle.id is null or lifecycle.scheduled_state is null)
  then raise exception 'no_scheduled_transition'; end if;
  if p_transition_kind in ('plan_start', 'plan_exit')
     and p_effective_on <= (clock_timestamp() at time zone 'Europe/Berlin')::date
  then raise exception 'future_effective_date_required'; end if;

  if target_state in ('inactive', 'exited') then
    if employee.user_id is not null and exists (
      select 1 from public.organizations organization
      where organization.id = p_organization_id and organization.admin_id = employee.user_id
    ) then raise exception 'organization_owner_protected'; end if;
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':responsibility-holders', 0)
    );
    select exists (
      with latest as (
        select distinct on (configuration.responsibility)
          configuration.id, configuration.mode
        from public.organization_responsibility_configurations configuration
        where configuration.organization_id = p_organization_id
          and configuration.effective_from <= clock_timestamp()
        order by configuration.responsibility, configuration.effective_from desc,
          configuration.created_at desc, configuration.id desc
      )
      select 1
      from latest
      join public.organization_responsibility_assignments assignment
        on assignment.configuration_id = latest.id
      where latest.mode = 'selected'
        and assignment.employee_record_id = p_employee_record_id
        and not exists (
          select 1
          from public.organization_responsibility_assignments other_assignment
          join public.employee_records other_record
            on other_record.id = other_assignment.employee_record_id
          join public.organization_members other_member
            on other_member.organization_id = other_record.organization_id
           and other_member.user_id = other_record.user_id
          where other_assignment.configuration_id = latest.id
            and other_assignment.employee_record_id <> p_employee_record_id
            and other_record.exit_date is null
        )
    ) into has_stranded_responsibility;
    if has_stranded_responsibility then raise exception 'last_responsibility_holder'; end if;
  end if;

  if lifecycle.id is null then
    insert into public.personnel_employment_lifecycles(
      organization_id, employee_record_id, state, state_effective_on,
      scheduled_state, scheduled_for, version, created_by, updated_by
    ) values (
      p_organization_id, p_employee_record_id,
      case
        when p_transition_kind = 'plan_start' then 'planned'
        when p_transition_kind = 'plan_exit' then 'notice'
        else target_state
      end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then
        (clock_timestamp() at time zone 'Europe/Berlin')::date else p_effective_on end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then target_state end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then p_effective_on end,
      1, p_actor_id, p_actor_id
    ) returning * into lifecycle;
    new_version := 1;
  else
    new_version := lifecycle.version + 1;
    update public.personnel_employment_lifecycles set
      state = case
        when p_transition_kind = 'cancel_scheduled' then state
        when p_transition_kind = 'plan_start' then 'planned'
        when p_transition_kind = 'plan_exit' then 'notice'
        else target_state
      end,
      state_effective_on = case
        when p_transition_kind in ('plan_start', 'plan_exit', 'cancel_scheduled') then state_effective_on
        else p_effective_on
      end,
      scheduled_state = case when p_transition_kind in ('plan_start', 'plan_exit') then target_state end,
      scheduled_for = case when p_transition_kind in ('plan_start', 'plan_exit') then p_effective_on end,
      version = new_version,
      updated_by = p_actor_id
    where id = lifecycle.id returning * into lifecycle;
  end if;

  if p_transition_kind in ('plan_start', 'start') then
    update public.employee_records set entry_date = p_effective_on, exit_date = null
    where id = p_employee_record_id;
  elsif p_transition_kind in ('plan_exit', 'exit') then
    update public.employee_records set exit_date = p_effective_on
    where id = p_employee_record_id;
  elsif p_transition_kind in ('reverse', 'reactivate') then
    update public.employee_records set exit_date = null where id = p_employee_record_id;
  end if;

  insert into public.personnel_employment_transitions(
    organization_id, employment_lifecycle_id, employee_record_id, transition_kind,
    from_state, to_state, effective_on, reason, lifecycle_version,
    operation_id, request_hash, unresolved_work, actor_id
  ) values (
    p_organization_id, lifecycle.id, p_employee_record_id, p_transition_kind,
    baseline_state, target_state, p_effective_on, btrim(p_reason), new_version,
    p_operation_id, p_request_hash, coalesce(p_unresolved_work, '[]'::jsonb), p_actor_id
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'employment_transition',
    jsonb_build_object(
      'transitionKind', p_transition_kind, 'fromState', baseline_state,
      'toState', target_state, 'effectiveOn', p_effective_on,
      'lifecycleVersion', new_version, 'reason', btrim(p_reason),
      'unresolvedWork', coalesce(p_unresolved_work, '[]'::jsonb)
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'employment_transition', lifecycle.id, p_actor_id
  );
  return lifecycle.id;
end;
$$;
