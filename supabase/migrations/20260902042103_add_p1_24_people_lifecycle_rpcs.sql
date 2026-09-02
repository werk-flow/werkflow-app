-- P1-24 authorization and atomic mutations. Public functions are callable
-- only by the server-side service role; each function still verifies the
-- passed actor against current organization access.

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

create or replace function app_private.p1_24_has_effective_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    app_private.p1_24_effective_access_state(p_organization_id, p_user_id, p_at) = 'active',
    false
  );
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
      and lifecycle.scheduled_for > p_at
  );
$$;

create or replace function app_private.p1_24_is_manager(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = p_user_id
        and member.role in ('admin', 'buero')
    );
$$;

create or replace function app_private.p1_24_is_admin(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = p_user_id
        and member.role = 'admin'
    );
$$;

create or replace function app_private.p1_24_is_self(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_user_id uuid,
  p_allow_prestart boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id
      and employee.organization_id = p_organization_id
      and employee.user_id = p_user_id
  ) and (
    app_private.p1_24_has_effective_access(p_organization_id, p_user_id)
    or (p_allow_prestart and app_private.p1_24_has_prestart_access(p_organization_id, p_user_id))
  );
$$;

create or replace function app_private.p1_24_assert_replay(
  p_organization_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  existing_result uuid;
  existing_hash text;
begin
  select operation.result_id, operation.request_hash
    into existing_result, existing_hash
  from public.personnel_lifecycle_operations operation
  where operation.organization_id = p_organization_id
    and operation.operation_id = p_operation_id;
  if not found then return null; end if;
  if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
  return existing_result;
end;
$$;

create or replace function app_private.p1_24_record_operation(
  p_organization_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_operation_kind text,
  p_result_id uuid,
  p_actor_id uuid
)
returns void language sql security definer set search_path = '' as $$
  insert into public.personnel_lifecycle_operations(
    organization_id, operation_id, request_hash, operation_kind, result_id, actor_id
  ) values (
    p_organization_id, p_operation_id, p_request_hash, p_operation_kind, p_result_id, p_actor_id
  );
$$;

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
declare
  lifecycle public.personnel_access_lifecycles;
  employee public.employee_records;
  effective_state public.personnel_access_state;
  target_state public.personnel_access_state;
  result_id uuid;
  new_version bigint;
  other_admin_count integer;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if p_effective_at is null or nullif(btrim(p_reason), '') is null then raise exception 'invalid_transition'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-access:' || p_employee_record_id::text, 0
  ));
  select * into employee from public.employee_records
  where id = p_employee_record_id and organization_id = p_organization_id;
  if employee.id is null then raise exception 'employee_record_not_found'; end if;
  select * into lifecycle from public.personnel_access_lifecycles
  where employee_record_id = p_employee_record_id for update;

  if lifecycle.id is not null and lifecycle.scheduled_for is not null
     and lifecycle.scheduled_for <= clock_timestamp() then
    update public.personnel_access_lifecycles set
      state = scheduled_state,
      state_effective_at = scheduled_for,
      scheduled_state = null,
      scheduled_for = null
    where id = lifecycle.id returning * into lifecycle;
  end if;

  if lifecycle.id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    effective_state := case
      when employee.user_id is not null and exists (
        select 1 from public.organization_members member
        where member.organization_id = p_organization_id and member.user_id = employee.user_id
      ) then 'active'::public.personnel_access_state
      else 'not_configured'::public.personnel_access_state
    end;
  else
    if p_expected_version is distinct from lifecycle.version then raise exception 'stale_version'; end if;
    effective_state := lifecycle.state;
  end if;

  if p_transition_kind = 'schedule_activation' then
    if p_effective_at <= clock_timestamp() then raise exception 'future_effective_at_required'; end if;
    target_state := 'active';
  elsif p_transition_kind in ('activate_now', 'reactivate') then
    if employee.user_id is null or not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id and member.user_id = employee.user_id
    ) then raise exception 'membership_required'; end if;
    target_state := 'active';
    p_effective_at := clock_timestamp();
  elsif p_transition_kind = 'schedule_suspension' then
    if p_effective_at <= clock_timestamp() then raise exception 'future_effective_at_required'; end if;
    if effective_state <> 'active' then raise exception 'active_access_required'; end if;
    target_state := 'suspended';
  elsif p_transition_kind = 'suspend_now' then
    target_state := 'suspended';
    p_effective_at := clock_timestamp();
  elsif p_transition_kind = 'end_access' then
    target_state := 'ended';
    if p_effective_at <= clock_timestamp() then p_effective_at := clock_timestamp(); end if;
  elsif p_transition_kind = 'cancel_scheduled' then
    if lifecycle.id is null or lifecycle.scheduled_state is null then raise exception 'no_scheduled_transition'; end if;
    target_state := lifecycle.state;
    p_effective_at := clock_timestamp();
  else
    raise exception 'invalid_transition';
  end if;

  if target_state in ('suspended', 'ended') and employee.user_id is not null then
    if exists (
      select 1 from public.organizations organization
      where organization.id = p_organization_id and organization.admin_id = employee.user_id
    ) then raise exception 'organization_owner_protected'; end if;
    if exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = employee.user_id and member.role = 'admin'
    ) then
      select count(*) into other_admin_count
      from public.organization_members member
      where member.organization_id = p_organization_id
        and member.role = 'admin'
        and member.user_id <> employee.user_id
        and app_private.p1_24_has_effective_access(p_organization_id, member.user_id);
      if other_admin_count = 0 then raise exception 'last_admin_protected'; end if;
    end if;
  end if;

  if lifecycle.id is null then
    insert into public.personnel_access_lifecycles(
      organization_id, employee_record_id, state, state_effective_at,
      scheduled_state, scheduled_for, version, created_by, updated_by
    ) values (
      p_organization_id, p_employee_record_id,
      case
        when p_transition_kind = 'schedule_activation' then 'scheduled'
        when p_transition_kind = 'schedule_suspension' then effective_state
        else target_state
      end,
      case when p_transition_kind in ('schedule_activation', 'schedule_suspension') then clock_timestamp() else p_effective_at end,
      case when p_transition_kind in ('schedule_activation', 'schedule_suspension') then target_state end,
      case when p_transition_kind in ('schedule_activation', 'schedule_suspension') then p_effective_at end,
      1, p_actor_id, p_actor_id
    ) returning * into lifecycle;
    new_version := 1;
  else
    new_version := lifecycle.version + 1;
    update public.personnel_access_lifecycles set
      state = case
        when p_transition_kind = 'cancel_scheduled' then state
        when p_transition_kind in ('schedule_activation', 'schedule_suspension') then
          case when p_transition_kind = 'schedule_activation' and state <> 'active' then 'scheduled' else state end
        else target_state
      end,
      state_effective_at = case
        when p_transition_kind in ('schedule_activation', 'schedule_suspension', 'cancel_scheduled') then state_effective_at
        else p_effective_at
      end,
      scheduled_state = case
        when p_transition_kind in ('schedule_activation', 'schedule_suspension') then target_state
        else null
      end,
      scheduled_for = case
        when p_transition_kind in ('schedule_activation', 'schedule_suspension') then p_effective_at
        else null
      end,
      version = new_version,
      updated_by = p_actor_id
    where id = lifecycle.id returning * into lifecycle;
  end if;

  insert into public.personnel_access_transitions(
    organization_id, access_lifecycle_id, employee_record_id, transition_kind,
    from_state, to_state, effective_at, reason, lifecycle_version,
    operation_id, request_hash, actor_id
  ) values (
    p_organization_id, lifecycle.id, p_employee_record_id, p_transition_kind,
    effective_state, target_state, p_effective_at, btrim(p_reason), new_version,
    p_operation_id, p_request_hash, p_actor_id
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'access_transition',
    jsonb_build_object(
      'transitionKind', p_transition_kind, 'fromState', effective_state,
      'toState', target_state, 'effectiveAt', p_effective_at,
      'lifecycleVersion', new_version, 'reason', btrim(p_reason)
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'access_transition', lifecycle.id, p_actor_id
  );
  return lifecycle.id;
end;
$$;

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
    select exists (
      with latest as (
        select distinct on (configuration.responsibility)
          configuration.id, configuration.mode
        from public.organization_responsibility_configurations configuration
        where configuration.organization_id = p_organization_id
          and configuration.effective_from <= clock_timestamp()
        order by configuration.responsibility, configuration.effective_from desc, configuration.created_at desc
      )
      select 1
      from latest
      join public.organization_responsibility_assignments assignment
        on assignment.configuration_id = latest.id
      where latest.mode = 'selected'
        and assignment.employee_record_id = p_employee_record_id
        and 1 = (
          select count(*) from public.organization_responsibility_assignments other
          where other.configuration_id = latest.id
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

create or replace function public.publish_personnel_onboarding_template(
  p_actor_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_version bigint,
  p_name text,
  p_description text,
  p_items jsonb,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  template public.personnel_onboarding_templates;
  template_version_id uuid;
  next_version integer;
  result_id uuid;
  item jsonb;
  item_index integer := 0;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_name), '') is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then raise exception 'invalid_template'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-template:' || coalesce(p_template_id::text, lower(btrim(p_name))), 0
  ));

  if p_template_id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    insert into public.personnel_onboarding_templates(
      organization_id, name, description, state, current_version_number,
      version, created_by, updated_by
    ) values (
      p_organization_id, btrim(p_name), nullif(btrim(p_description), ''),
      'published', 1, 1, p_actor_id, p_actor_id
    ) returning * into template;
    next_version := 1;
  else
    select * into template from public.personnel_onboarding_templates
    where id = p_template_id and organization_id = p_organization_id for update;
    if template.id is null then raise exception 'template_not_found'; end if;
    if template.version <> p_expected_version then raise exception 'stale_version'; end if;
    next_version := template.current_version_number + 1;
    update public.personnel_onboarding_templates set
      name = btrim(p_name), description = nullif(btrim(p_description), ''),
      state = 'published', current_version_number = next_version,
      version = version + 1, updated_by = p_actor_id
    where id = template.id returning * into template;
  end if;

  insert into public.personnel_onboarding_template_versions(
    organization_id, template_id, version_number, name, description,
    published_by, operation_id, request_hash
  ) values (
    p_organization_id, template.id, next_version, btrim(p_name),
    nullif(btrim(p_description), ''), p_actor_id, p_operation_id, p_request_hash
  ) returning id into template_version_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(item->>'title'), '') is null then raise exception 'invalid_template_item'; end if;
    insert into public.personnel_onboarding_template_items(
      organization_id, template_version_id, requirement_type, title,
      description, is_required, blocks_access, due_offset_days, sort_order
    ) values (
      p_organization_id, template_version_id,
      (item->>'requirementType')::public.personnel_requirement_type,
      btrim(item->>'title'), nullif(btrim(item->>'description'), ''),
      coalesce((item->>'isRequired')::boolean, true),
      coalesce((item->>'blocksAccess')::boolean, false),
      (item->>'dueOffsetDays')::integer, item_index
    );
    item_index := item_index + 1;
  end loop;
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'publish_onboarding_template', template_version_id, p_actor_id
  );
  return template_version_id;
end;
$$;

create or replace function public.create_personnel_onboarding_plan(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_template_version_id uuid,
  p_name text,
  p_target_start_date date,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result_id uuid;
  new_plan_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_name), '') is null or not exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
  ) then raise exception 'invalid_plan'; end if;
  if p_template_version_id is not null and not exists (
    select 1 from public.personnel_onboarding_template_versions version
    where version.id = p_template_version_id and version.organization_id = p_organization_id
  ) then raise exception 'template_version_not_found'; end if;

  insert into public.personnel_onboarding_plans(
    organization_id, employee_record_id, template_version_id, name,
    target_start_date, created_by, updated_by
  ) values (
    p_organization_id, p_employee_record_id, p_template_version_id,
    btrim(p_name), p_target_start_date, p_actor_id, p_actor_id
  ) returning id into new_plan_id;

  if p_template_version_id is not null then
    insert into public.personnel_onboarding_requirements(
      organization_id, plan_id, employee_record_id, source_template_item_id,
      requirement_type, title, description, is_required, blocks_access,
      due_date, sort_order, created_by, updated_by
    )
    select p_organization_id, new_plan_id, p_employee_record_id, item.id,
      item.requirement_type, item.title, item.description, item.is_required,
      item.blocks_access,
      case when p_target_start_date is not null and item.due_offset_days is not null
        then p_target_start_date + item.due_offset_days else null end,
      item.sort_order, p_actor_id, p_actor_id
    from public.personnel_onboarding_template_items item
    where item.template_version_id = p_template_version_id
      and item.organization_id = p_organization_id
    order by item.sort_order;
  end if;
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'onboarding_plan_created',
    jsonb_build_object('planId', new_plan_id, 'templateVersionId', p_template_version_id),
    p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'create_onboarding_plan', new_plan_id, p_actor_id
  );
  return new_plan_id;
end;
$$;

create or replace function public.save_personnel_onboarding_requirement(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan_id uuid,
  p_requirement_id uuid,
  p_expected_version bigint,
  p_requirement_type public.personnel_requirement_type,
  p_title text,
  p_description text,
  p_is_required boolean,
  p_blocks_access boolean,
  p_owner_employee_record_id uuid,
  p_due_date date,
  p_state public.personnel_requirement_state,
  p_blocker_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  plan public.personnel_onboarding_plans;
  requirement public.personnel_onboarding_requirements;
  result_id uuid;
  next_order integer;
  next_plan_state public.personnel_onboarding_plan_state;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_title), '') is null or (p_state = 'blocked' and nullif(btrim(p_blocker_reason), '') is null)
  then raise exception 'invalid_requirement'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-24-plan:' || p_plan_id::text, 0));
  select * into plan from public.personnel_onboarding_plans
  where id = p_plan_id and organization_id = p_organization_id for update;
  if plan.id is null then raise exception 'plan_not_found'; end if;
  if p_owner_employee_record_id is not null and not exists (
    select 1 from public.employee_records employee
    where employee.id = p_owner_employee_record_id and employee.organization_id = p_organization_id
  ) then raise exception 'owner_not_found'; end if;

  if p_requirement_id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    select coalesce(max(existing.sort_order), -1) + 1 into next_order
    from public.personnel_onboarding_requirements existing where existing.plan_id = p_plan_id;
    insert into public.personnel_onboarding_requirements(
      organization_id, plan_id, employee_record_id, requirement_type, title,
      description, is_required, blocks_access, owner_employee_record_id,
      due_date, state, blocker_reason, sort_order, created_by, updated_by
    ) values (
      p_organization_id, p_plan_id, plan.employee_record_id, p_requirement_type,
      btrim(p_title), nullif(btrim(p_description), ''), p_is_required,
      p_blocks_access, p_owner_employee_record_id, p_due_date, p_state,
      case when p_state = 'blocked' then btrim(p_blocker_reason) end,
      next_order, p_actor_id, p_actor_id
    ) returning * into requirement;
  else
    select * into requirement from public.personnel_onboarding_requirements
    where id = p_requirement_id and plan_id = p_plan_id
      and organization_id = p_organization_id for update;
    if requirement.id is null then raise exception 'requirement_not_found'; end if;
    if requirement.version <> p_expected_version then raise exception 'stale_version'; end if;
    update public.personnel_onboarding_requirements set
      requirement_type = p_requirement_type, title = btrim(p_title),
      description = nullif(btrim(p_description), ''), is_required = p_is_required,
      blocks_access = p_blocks_access, owner_employee_record_id = p_owner_employee_record_id,
      due_date = p_due_date, state = p_state,
      blocker_reason = case when p_state = 'blocked' then btrim(p_blocker_reason) end,
      version = version + 1, updated_by = p_actor_id
    where id = requirement.id returning * into requirement;
  end if;

  select case
    when exists (select 1 from public.personnel_onboarding_requirements item where item.plan_id = p_plan_id and item.state = 'blocked')
      then 'blocked'::public.personnel_onboarding_plan_state
    when exists (select 1 from public.personnel_onboarding_requirements item where item.plan_id = p_plan_id)
      and not exists (
        select 1 from public.personnel_onboarding_requirements item
        where item.plan_id = p_plan_id and item.is_required
          and item.state not in ('fulfilled', 'waived')
      ) then 'ready'::public.personnel_onboarding_plan_state
    else 'in_progress'::public.personnel_onboarding_plan_state
  end into next_plan_state;
  update public.personnel_onboarding_plans set
    state = next_plan_state, version = version + 1, updated_by = p_actor_id
  where id = p_plan_id;
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, plan.employee_record_id, 'onboarding_requirement_saved',
    jsonb_build_object(
      'planId', p_plan_id, 'requirementId', requirement.id,
      'requirementVersion', requirement.version, 'state', requirement.state,
      'blocksAccess', requirement.blocks_access
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'save_onboarding_requirement', requirement.id, p_actor_id
  );
  return requirement.id;
end;
$$;

create or replace function public.classify_personnel_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_document_id uuid,
  p_expected_version bigint,
  p_document_type text,
  p_access_class public.personnel_document_access_class,
  p_evidence_state public.personnel_document_evidence_state,
  p_valid_until date,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  protected_document public.personnel_documents;
  result_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id)
     or (p_access_class <> 'personnel_standard' and not app_private.p1_24_is_admin(p_organization_id, p_actor_id))
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_document_type), '') is null then raise exception 'invalid_document_type'; end if;
  if not exists (select 1 from public.employee_records employee where employee.id = p_employee_record_id and employee.organization_id = p_organization_id)
     or not exists (select 1 from public.documents document where document.id = p_document_id and document.organization_id = p_organization_id)
  then raise exception 'invalid_reference'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-24-document:' || p_document_id::text, 0));
  select * into protected_document from public.personnel_documents
  where document_id = p_document_id for update;
  if protected_document.id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    insert into public.personnel_documents(
      organization_id, employee_record_id, document_id, document_type,
      access_class, evidence_state, valid_until, classified_by, updated_by
    ) values (
      p_organization_id, p_employee_record_id, p_document_id, btrim(p_document_type),
      p_access_class, p_evidence_state, p_valid_until, p_actor_id, p_actor_id
    ) returning * into protected_document;
  else
    if protected_document.organization_id <> p_organization_id
       or protected_document.employee_record_id <> p_employee_record_id
    then raise exception 'invalid_reference'; end if;
    if protected_document.version <> p_expected_version then raise exception 'stale_version'; end if;
    update public.personnel_documents set
      document_type = btrim(p_document_type), access_class = p_access_class,
      evidence_state = p_evidence_state, valid_until = p_valid_until,
      version = version + 1, updated_by = p_actor_id
    where id = protected_document.id returning * into protected_document;
  end if;
  insert into public.document_audit_events(
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'personnel_classified',
    jsonb_build_object(
      'employeeRecordId', p_employee_record_id, 'documentType', btrim(p_document_type),
      'accessClass', p_access_class, 'evidenceState', p_evidence_state,
      'validUntil', p_valid_until, 'version', protected_document.version
    )
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'personnel_document_classified',
    jsonb_build_object('personnelDocumentId', protected_document.id, 'documentId', p_document_id),
    p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'classify_personnel_document', protected_document.id, p_actor_id
  );
  return protected_document.id;
end;
$$;

create or replace function public.finalize_personnel_document_metadata(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_document_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_file_name text,
  p_display_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_document_type text,
  p_access_class public.personnel_document_access_class,
  p_evidence_state public.personnel_document_evidence_state,
  p_valid_until date,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  personnel_document_id uuid;
  result_id uuid;
  self_health_upload boolean;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  self_health_upload := p_access_class = 'health_evidence'
    and app_private.p1_24_is_self(p_organization_id, p_employee_record_id, p_actor_id, true);
  if not self_health_upload and (
    not app_private.p1_24_is_manager(p_organization_id, p_actor_id)
    or (p_access_class <> 'personnel_standard' and not app_private.p1_24_is_admin(p_organization_id, p_actor_id))
  )
  then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.employee_records employee where employee.id = p_employee_record_id and employee.organization_id = p_organization_id)
     or p_size_bytes <= 0 or nullif(btrim(p_storage_path), '') is null
     or nullif(btrim(p_original_file_name), '') is null or nullif(btrim(p_display_name), '') is null
     or nullif(btrim(p_document_type), '') is null
  then raise exception 'invalid_document'; end if;
  insert into public.documents(
    id, organization_id, storage_bucket, storage_path, original_file_name,
    display_name, category, mime_type, size_bytes, uploaded_by
  ) values (
    p_document_id, p_organization_id, p_storage_bucket, p_storage_path,
    p_original_file_name, p_display_name, p_category, p_mime_type,
    p_size_bytes, p_actor_id
  );
  insert into public.personnel_documents(
    organization_id, employee_record_id, document_id, document_type,
    access_class, evidence_state, valid_until, classified_by, updated_by
  ) values (
    p_organization_id, p_employee_record_id, p_document_id, btrim(p_document_type),
    p_access_class, p_evidence_state, p_valid_until, p_actor_id, p_actor_id
  ) returning id into personnel_document_id;
  if self_health_upload then
    insert into public.personnel_document_releases(
      organization_id, personnel_document_id, employee_record_id,
      document_version_number, released_by, operation_id, request_hash
    ) values (
      p_organization_id, personnel_document_id, p_employee_record_id,
      1, p_actor_id, p_operation_id, p_request_hash
    );
  end if;
  insert into public.document_audit_events(
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object(
      'displayName', p_display_name, 'originalFileName', p_original_file_name,
      'category', p_category, 'sizeBytes', p_size_bytes, 'mimeType', p_mime_type,
      'employeeRecordId', p_employee_record_id, 'protected', true
    )
  ), (
    p_organization_id, p_document_id, p_actor_id, 'personnel_classified',
    jsonb_build_object(
      'personnelDocumentId', personnel_document_id, 'employeeRecordId', p_employee_record_id,
      'documentType', btrim(p_document_type), 'accessClass', p_access_class,
      'evidenceState', p_evidence_state, 'validUntil', p_valid_until, 'version', 1
    )
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'personnel_document_uploaded',
    jsonb_build_object('personnelDocumentId', personnel_document_id, 'documentId', p_document_id),
    p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'finalize_personnel_document', p_document_id, p_actor_id
  );
  return p_document_id;
end;
$$;

create or replace function public.set_personnel_document_release(
  p_actor_id uuid,
  p_organization_id uuid,
  p_personnel_document_id uuid,
  p_document_version_number integer,
  p_release boolean,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  protected_document public.personnel_documents;
  release_record public.personnel_document_releases;
  document_record public.documents;
  result_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  select * into protected_document from public.personnel_documents
  where id = p_personnel_document_id and organization_id = p_organization_id;
  if protected_document.id is null then raise exception 'personnel_document_not_found'; end if;
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id)
     or (protected_document.access_class <> 'personnel_standard' and not app_private.p1_24_is_admin(p_organization_id, p_actor_id))
  then raise exception 'forbidden'; end if;
  select * into document_record from public.documents where id = protected_document.document_id;
  if p_document_version_number <= 0 or not (
    document_record.current_version_number = p_document_version_number
    or exists (
      select 1 from public.document_versions version
      where version.document_id = document_record.id
        and version.version_number = p_document_version_number
    )
  ) then raise exception 'document_version_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-24-release:' || p_personnel_document_id::text, 0));
  select * into release_record from public.personnel_document_releases
  where personnel_document_id = p_personnel_document_id
    and document_version_number = p_document_version_number for update;
  if p_release then
    if release_record.id is null then
      insert into public.personnel_document_releases(
        organization_id, personnel_document_id, employee_record_id,
        document_version_number, released_by, operation_id, request_hash
      ) values (
        p_organization_id, p_personnel_document_id, protected_document.employee_record_id,
        p_document_version_number, p_actor_id, p_operation_id, p_request_hash
      ) returning * into release_record;
    elsif release_record.revoked_at is not null then
      update public.personnel_document_releases set
        released_by = p_actor_id, released_at = clock_timestamp(),
        revoked_by = null, revoked_at = null, revoke_reason = null,
        operation_id = p_operation_id, request_hash = p_request_hash
      where id = release_record.id returning * into release_record;
    end if;
  else
    if release_record.id is null or release_record.revoked_at is not null then raise exception 'release_not_active'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
    update public.personnel_document_releases set
      revoked_by = p_actor_id, revoked_at = clock_timestamp(), revoke_reason = btrim(p_reason)
    where id = release_record.id returning * into release_record;
  end if;
  insert into public.document_audit_events(
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, protected_document.document_id, p_actor_id,
    case when p_release then 'personnel_released' else 'personnel_release_revoked' end,
    jsonb_build_object(
      'personnelDocumentId', p_personnel_document_id,
      'documentVersionNumber', p_document_version_number,
      'reason', nullif(btrim(p_reason), '')
    )
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    case when p_release then 'release_personnel_document' else 'revoke_personnel_document_release' end,
    release_record.id, p_actor_id
  );
  return release_record.id;
end;
$$;

create or replace function public.acknowledge_personnel_item(
  p_actor_id uuid,
  p_organization_id uuid,
  p_acknowledgement_kind public.personnel_acknowledgement_kind,
  p_personnel_document_id uuid,
  p_document_version_number integer,
  p_requirement_id uuid,
  p_requirement_version bigint,
  p_statement text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  employee_id uuid;
  acknowledgement_id uuid;
  result_id uuid;
  requirement public.personnel_onboarding_requirements;
  next_plan_state public.personnel_onboarding_plan_state;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if nullif(btrim(p_statement), '') is null then raise exception 'statement_required'; end if;
  if p_acknowledgement_kind = 'document_received' then
    select protected.employee_record_id into employee_id
    from public.personnel_documents protected
    join public.personnel_document_releases release
      on release.personnel_document_id = protected.id
     and release.document_version_number = p_document_version_number
     and release.revoked_at is null
    where protected.id = p_personnel_document_id
      and protected.organization_id = p_organization_id;
    if employee_id is null then raise exception 'document_not_released'; end if;
  elsif p_acknowledgement_kind = 'requirement_completed' then
    select * into requirement from public.personnel_onboarding_requirements
    where id = p_requirement_id and organization_id = p_organization_id for update;
    if requirement.id is null then raise exception 'requirement_not_found'; end if;
    if requirement.version <> p_requirement_version then raise exception 'stale_version'; end if;
    employee_id := requirement.employee_record_id;
  else
    raise exception 'invalid_acknowledgement';
  end if;
  if not app_private.p1_24_is_self(p_organization_id, employee_id, p_actor_id, true)
  then raise exception 'forbidden'; end if;
  insert into public.personnel_acknowledgements(
    organization_id, employee_record_id, acknowledgement_kind,
    personnel_document_id, document_version_number, requirement_id,
    requirement_version, statement, acknowledged_by, operation_id, request_hash
  ) values (
    p_organization_id, employee_id, p_acknowledgement_kind,
    p_personnel_document_id, p_document_version_number, p_requirement_id,
    p_requirement_version, btrim(p_statement), p_actor_id, p_operation_id, p_request_hash
  ) returning id into acknowledgement_id;
  if requirement.id is not null then
    update public.personnel_onboarding_requirements set
      state = 'fulfilled', version = version + 1, updated_by = p_actor_id
    where id = requirement.id;
    select case
      when exists (
        select 1 from public.personnel_onboarding_requirements item
        where item.plan_id = requirement.plan_id and item.state = 'blocked'
      ) then 'blocked'::public.personnel_onboarding_plan_state
      when not exists (
        select 1 from public.personnel_onboarding_requirements item
        where item.plan_id = requirement.plan_id and item.is_required
          and item.state not in ('fulfilled', 'waived')
      ) then 'ready'::public.personnel_onboarding_plan_state
      else 'in_progress'::public.personnel_onboarding_plan_state
    end into next_plan_state;
    update public.personnel_onboarding_plans set
      state = next_plan_state, version = version + 1, updated_by = p_actor_id
    where id = requirement.plan_id;
  end if;
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, employee_id, 'personnel_acknowledged',
    jsonb_build_object(
      'acknowledgementId', acknowledgement_id, 'kind', p_acknowledgement_kind,
      'personnelDocumentId', p_personnel_document_id,
      'documentVersionNumber', p_document_version_number,
      'requirementId', p_requirement_id, 'requirementVersion', p_requirement_version
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'acknowledge_personnel_item', acknowledgement_id, p_actor_id
  );
  return acknowledgement_id;
end;
$$;

-- Private helpers never form public endpoints.
revoke all on function app_private.p1_24_effective_access_state(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.p1_24_has_effective_access(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.p1_24_has_prestart_access(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.p1_24_is_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.p1_24_is_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.p1_24_is_self(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function app_private.p1_24_assert_replay(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.p1_24_record_operation(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.p1_24_effective_access_state(uuid, uuid, timestamptz) to service_role;
grant execute on function app_private.p1_24_has_effective_access(uuid, uuid, timestamptz) to service_role;
grant execute on function app_private.p1_24_has_prestart_access(uuid, uuid, timestamptz) to service_role;
grant execute on function app_private.p1_24_is_manager(uuid, uuid) to service_role;
grant execute on function app_private.p1_24_is_admin(uuid, uuid) to service_role;
grant execute on function app_private.p1_24_is_self(uuid, uuid, uuid, boolean) to service_role;
grant execute on function app_private.p1_24_assert_replay(uuid, uuid, text) to service_role;
grant execute on function app_private.p1_24_record_operation(uuid, uuid, text, text, uuid, uuid) to service_role;

revoke all on function public.set_personnel_access_transition(uuid, uuid, uuid, bigint, public.personnel_access_transition_kind, timestamptz, text, uuid, text) from public, anon, authenticated;
revoke all on function public.set_personnel_employment_transition(uuid, uuid, uuid, bigint, public.personnel_employment_transition_kind, date, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.publish_personnel_onboarding_template(uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.create_personnel_onboarding_plan(uuid, uuid, uuid, uuid, text, date, uuid, text) from public, anon, authenticated;
revoke all on function public.save_personnel_onboarding_requirement(uuid, uuid, uuid, uuid, bigint, public.personnel_requirement_type, text, text, boolean, boolean, uuid, date, public.personnel_requirement_state, text, uuid, text) from public, anon, authenticated;
revoke all on function public.classify_personnel_document(uuid, uuid, uuid, uuid, bigint, text, public.personnel_document_access_class, public.personnel_document_evidence_state, date, uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_personnel_document_metadata(uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint, text, public.personnel_document_access_class, public.personnel_document_evidence_state, date, uuid, text) from public, anon, authenticated;
revoke all on function public.set_personnel_document_release(uuid, uuid, uuid, integer, boolean, text, uuid, text) from public, anon, authenticated;
revoke all on function public.acknowledge_personnel_item(uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer, uuid, bigint, text, uuid, text) from public, anon, authenticated;

grant execute on function public.set_personnel_access_transition(uuid, uuid, uuid, bigint, public.personnel_access_transition_kind, timestamptz, text, uuid, text) to service_role;
grant execute on function public.set_personnel_employment_transition(uuid, uuid, uuid, bigint, public.personnel_employment_transition_kind, date, text, jsonb, uuid, text) to service_role;
grant execute on function public.publish_personnel_onboarding_template(uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text) to service_role;
grant execute on function public.create_personnel_onboarding_plan(uuid, uuid, uuid, uuid, text, date, uuid, text) to service_role;
grant execute on function public.save_personnel_onboarding_requirement(uuid, uuid, uuid, uuid, bigint, public.personnel_requirement_type, text, text, boolean, boolean, uuid, date, public.personnel_requirement_state, text, uuid, text) to service_role;
grant execute on function public.classify_personnel_document(uuid, uuid, uuid, uuid, bigint, text, public.personnel_document_access_class, public.personnel_document_evidence_state, date, uuid, text) to service_role;
grant execute on function public.finalize_personnel_document_metadata(uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint, text, public.personnel_document_access_class, public.personnel_document_evidence_state, date, uuid, text) to service_role;
grant execute on function public.set_personnel_document_release(uuid, uuid, uuid, integer, boolean, text, uuid, text) to service_role;
grant execute on function public.acknowledge_personnel_item(uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer, uuid, bigint, text, uuid, text) to service_role;
