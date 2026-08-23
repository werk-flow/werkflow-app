create or replace function app_private.prevent_work_template_history_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 and tg_op = 'DELETE' then
    return old;
  end if;
  if pg_trigger_depth() > 1 and tg_op = 'UPDATE' then
    if tg_table_name = 'work_template_applications'
      and to_jsonb(old) - 'applied_by' = to_jsonb(new) - 'applied_by' then
      return new;
    end if;
    if tg_table_name = 'work_template_events'
      and to_jsonb(old) - 'actor_id' = to_jsonb(new) - 'actor_id' then
      return new;
    end if;
  end if;
  raise exception 'work_template_history_immutable';
end;
$$;

create or replace function app_private.validate_work_template_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child_organization_id uuid;
  child_version_id uuid;
  previous_version_status text;
  version_status text;
begin
  if pg_trigger_depth() > 1 and tg_op = 'DELETE' then
    return old;
  end if;
  if pg_trigger_depth() > 1 and tg_op = 'UPDATE'
    and to_jsonb(old) - 'created_by' - 'updated_at' - 'copied_from_item_id'
      = to_jsonb(new) - 'created_by' - 'updated_at' - 'copied_from_item_id' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    child_organization_id := old.organization_id;
    child_version_id := old.version_id;
  else
    child_organization_id := new.organization_id;
    child_version_id := new.version_id;
  end if;

  if tg_op = 'UPDATE' then
    select version.status into previous_version_status
    from public.work_template_versions version
    where version.id = old.version_id
      and version.organization_id = old.organization_id;
    if previous_version_status is null then
      raise exception 'work_template_child_organization_mismatch';
    end if;
    if previous_version_status <> 'draft' then
      raise exception 'published_work_template_version_immutable';
    end if;
  end if;

  select version.status into version_status
  from public.work_template_versions version
  where version.id = child_version_id
    and version.organization_id = child_organization_id;
  if version_status is null then
    raise exception 'work_template_child_organization_mismatch';
  end if;
  if version_status <> 'draft' then
    raise exception 'published_work_template_version_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function app_private.work_template_dependency_has_cycle(
  p_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive reachable(start_item_id, current_item_id) as (
    select dependency.predecessor_item_id, dependency.dependent_item_id
    from public.work_template_item_dependencies dependency
    where dependency.version_id = p_version_id
    union
    select reachable.start_item_id, dependency.dependent_item_id
    from reachable
    join public.work_template_item_dependencies dependency
      on dependency.version_id = p_version_id
     and dependency.predecessor_item_id = reachable.current_item_id
  )
  select exists (
    select 1 from reachable where start_item_id = current_item_id
  );
$$;

create or replace function public.update_instruction_item_details(
  p_organization_id uuid,
  p_instruction_item_id uuid,
  p_actor_id uuid,
  p_item_kind text,
  p_requirement_state text,
  p_group_label text default null,
  p_notes text default null,
  p_evidence jsonb default '[]'::jsonb,
  p_predecessor_item_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_job_id uuid;
  target_project_id uuid;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if p_item_kind not in ('task', 'checklist')
    or p_requirement_state not in ('required', 'optional')
    or length(coalesce(p_group_label, '')) > 120
    or length(coalesce(p_notes, '')) > 2000
    or jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 100 then
    raise exception 'instruction_item_details_invalid';
  end if;

  select item.job_id, item.project_id into target_job_id, target_project_id
  from public.job_instruction_items item
  where item.id = p_instruction_item_id
    and item.organization_id = p_organization_id
  for update;
  if not found then raise exception 'item_not_found'; end if;

  if target_job_id is not null then
    perform 1 from public.jobs job
    where job.id = target_job_id and job.organization_id = p_organization_id
    for update;
  else
    perform 1 from public.projects project
    where project.id = target_project_id and project.organization_id = p_organization_id
    for update;
  end if;

  if p_instruction_item_id = any(coalesce(p_predecessor_item_ids, '{}'::uuid[])) then
    raise exception 'instruction_dependency_self';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id
    left join public.job_instruction_items predecessor on predecessor.id = predecessor_id
    where predecessor.id is null
       or predecessor.organization_id <> p_organization_id
       or predecessor.job_id is distinct from target_job_id
       or predecessor.project_id is distinct from target_project_id
  ) then
    raise exception 'instruction_dependency_target_invalid';
  end if;

  update public.job_instruction_items
  set item_kind = p_item_kind,
      requirement_state = p_requirement_state,
      group_label = nullif(btrim(coalesce(p_group_label, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_instruction_item_id;

  delete from public.job_instruction_item_evidence_requirements
  where instruction_item_id = p_instruction_item_id;
  insert into public.job_instruction_item_evidence_requirements (
    id, organization_id, instruction_item_id, description,
    document_category, sort_order, created_by, updated_by
  )
  select evidence.id, p_organization_id, p_instruction_item_id,
    btrim(evidence.description), evidence.document_category,
    evidence.sort_order, p_actor_id, p_actor_id
  from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) as evidence(
    id uuid, description text, document_category text, sort_order integer
  );

  delete from public.job_instruction_item_dependencies
  where dependent_item_id = p_instruction_item_id;
  insert into public.job_instruction_item_dependencies (
    organization_id, predecessor_item_id, dependent_item_id, created_by
  )
  select p_organization_id, predecessor_id, p_instruction_item_id, p_actor_id
  from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id;

  if exists (
    with recursive reachable(start_id, current_id) as (
      select dependency.predecessor_item_id, dependency.dependent_item_id
      from public.job_instruction_item_dependencies dependency
      join public.job_instruction_items dependent
        on dependent.id = dependency.dependent_item_id
      where dependent.organization_id = p_organization_id
        and dependent.job_id is not distinct from target_job_id
        and dependent.project_id is not distinct from target_project_id
      union
      select reachable.start_id, dependency.dependent_item_id
      from reachable
      join public.job_instruction_item_dependencies dependency
        on dependency.predecessor_item_id = reachable.current_id
    )
    select 1 from reachable where start_id = current_id
  ) then
    raise exception 'instruction_dependency_cycle';
  end if;
end;
$$;

create or replace function public.replace_project_capability_requirements_checked(
  p_organization_id uuid,
  p_project_id uuid,
  p_capability_ids uuid[],
  p_require_confirmations boolean[],
  p_expected_capability_ids uuid[],
  p_expected_require_confirmations boolean[],
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_capability_ids uuid[];
  current_require_confirmations boolean[];
  normalized_capability_ids uuid[];
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if cardinality(coalesce(p_capability_ids, '{}'::uuid[])) <>
      cardinality(coalesce(p_require_confirmations, '{}'::boolean[]))
    or cardinality(coalesce(p_expected_capability_ids, '{}'::uuid[])) <>
      cardinality(coalesce(p_expected_require_confirmations, '{}'::boolean[])) then
    raise exception 'requirement_array_length_mismatch';
  end if;

  perform 1 from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id
  for update;
  if not found then raise exception 'project_organization_mismatch'; end if;

  select
    coalesce(array_agg(requirement.capability_id order by requirement.capability_id), '{}'::uuid[]),
    coalesce(array_agg(requirement.require_confirmation order by requirement.capability_id), '{}'::boolean[])
  into current_capability_ids, current_require_confirmations
  from public.job_capability_requirements requirement
  where requirement.organization_id = p_organization_id
    and requirement.project_id = p_project_id;
  if current_capability_ids is distinct from coalesce(p_expected_capability_ids, '{}'::uuid[])
    or current_require_confirmations is distinct from coalesce(p_expected_require_confirmations, '{}'::boolean[]) then
    raise exception 'project_capability_requirements_conflict';
  end if;

  select coalesce(array_agg(distinct capability_id order by capability_id), '{}'::uuid[])
  into normalized_capability_ids
  from unnest(coalesce(p_capability_ids, '{}'::uuid[])) capability_id;
  if cardinality(normalized_capability_ids) <>
      cardinality(coalesce(p_capability_ids, '{}'::uuid[])) then
    raise exception 'duplicate_capability_requirement';
  end if;
  if (
    select count(*)
    from public.organization_capabilities capability
    where capability.organization_id = p_organization_id
      and capability.retired_at is null
      and capability.id = any(normalized_capability_ids)
  ) <> cardinality(normalized_capability_ids) then
    raise exception 'capability_organization_mismatch_or_retired';
  end if;

  delete from public.job_capability_requirements requirement
  where requirement.organization_id = p_organization_id
    and requirement.project_id = p_project_id
    and not (requirement.capability_id = any(normalized_capability_ids));

  insert into public.job_capability_requirements (
    organization_id, job_id, project_id, capability_id,
    require_confirmation, created_by, updated_by
  )
  select p_organization_id, null, p_project_id,
    p_capability_ids[index_value], p_require_confirmations[index_value],
    p_actor_id, p_actor_id
  from generate_subscripts(coalesce(p_capability_ids, '{}'::uuid[]), 1) index_value
  on conflict (project_id, capability_id) where project_id is not null
  do update set
    require_confirmation = excluded.require_confirmation,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;

revoke all on function app_private.assert_work_template_manager(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.work_template_dependency_has_cycle(uuid)
  from public, anon, authenticated;
revoke all on function public.update_instruction_item_details(
  uuid, uuid, uuid, text, text, text, text, jsonb, uuid[]
) from public, anon, authenticated;
revoke all on function public.replace_project_capability_requirements_checked(
  uuid, uuid, uuid[], boolean[], uuid[], boolean[], uuid
) from public, anon, authenticated;

grant execute on function app_private.assert_work_template_manager(uuid, uuid)
  to service_role;
grant execute on function app_private.work_template_dependency_has_cycle(uuid)
  to service_role;
grant execute on function public.update_instruction_item_details(
  uuid, uuid, uuid, text, text, text, text, jsonb, uuid[]
) to service_role;
grant execute on function public.replace_project_capability_requirements_checked(
  uuid, uuid, uuid[], boolean[], uuid[], boolean[], uuid
) to service_role;
