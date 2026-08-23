-- Serialize applications per work target while preserving the explicit, verified
-- materialization implementation from the preceding migration.
alter function public.apply_work_template(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[],
  jsonb, jsonb, text, text, uuid
) rename to apply_work_template_unserialized;

revoke all on function public.apply_work_template_unserialized(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[],
  jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.apply_work_template_unserialized(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[],
  jsonb, jsonb, text, text, uuid
) to service_role;

create function public.apply_work_template(
  p_organization_id uuid,
  p_template_version_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_job_id uuid default null,
  p_project_id uuid default null,
  p_allow_additional boolean default false,
  p_assessed_for_date date default null,
  p_selected_user_ids uuid[] default null,
  p_selected_employee_record_ids uuid[] default null,
  p_requirements_snapshot jsonb default null,
  p_coverage_snapshot jsonb default null,
  p_coverage_fingerprint text default null,
  p_override_reason text default null,
  p_team_source_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  existing_application_id uuid;
  target_id uuid;
begin
  if num_nonnulls(p_job_id, p_project_id) <> 1 then
    raise exception 'work_template_application_target_invalid';
  end if;
  if length(normalized_idempotency_key) not between 8 and 200 then
    raise exception 'work_template_idempotency_invalid';
  end if;

  target_id := coalesce(p_job_id, p_project_id);
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || target_id::text, 0)
  );

  select application.id into existing_application_id
  from public.work_template_applications application
  where application.organization_id = p_organization_id
    and application.idempotency_key = normalized_idempotency_key;
  if existing_application_id is not null then
    return jsonb_build_object(
      'applicationId', existing_application_id,
      'wasCreated', false
    );
  end if;

  return public.apply_work_template_unserialized(
    p_organization_id,
    p_template_version_id,
    p_actor_id,
    normalized_idempotency_key,
    p_job_id,
    p_project_id,
    p_allow_additional,
    p_assessed_for_date,
    p_selected_user_ids,
    p_selected_employee_record_ids,
    p_requirements_snapshot,
    p_coverage_snapshot,
    p_coverage_fingerprint,
    p_override_reason,
    p_team_source_id
  );
end;
$$;

revoke all on function public.apply_work_template(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[],
  jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.apply_work_template(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[],
  jsonb, jsonb, text, text, uuid
) to service_role;

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
    or jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 100
    or cardinality(coalesce(p_predecessor_item_ids, '{}'::uuid[])) > 200 then
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
  if cardinality(coalesce(p_predecessor_item_ids, '{}'::uuid[])) is distinct from (
    select count(distinct predecessor_id)
    from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id
  ) then
    raise exception 'instruction_item_details_invalid';
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
  where id = p_instruction_item_id
    and organization_id = p_organization_id;

  delete from public.job_instruction_item_evidence_requirements existing
  where existing.organization_id = p_organization_id
    and existing.instruction_item_id = p_instruction_item_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) incoming(
        id uuid, description text, document_category text, sort_order integer
      )
      where incoming.id = existing.id
    );

  update public.job_instruction_item_evidence_requirements existing
  set description = btrim(incoming.description),
      document_category = incoming.document_category,
      sort_order = incoming.sort_order,
      updated_by = p_actor_id,
      updated_at = now()
  from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) incoming(
    id uuid, description text, document_category text, sort_order integer
  )
  where existing.id = incoming.id
    and existing.organization_id = p_organization_id
    and existing.instruction_item_id = p_instruction_item_id;

  insert into public.job_instruction_item_evidence_requirements (
    organization_id, instruction_item_id, description,
    document_category, sort_order, created_by, updated_by
  )
  select p_organization_id, p_instruction_item_id,
    btrim(incoming.description), incoming.document_category,
    incoming.sort_order, p_actor_id, p_actor_id
  from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) incoming(
    id uuid, description text, document_category text, sort_order integer
  )
  where not exists (
    select 1
    from public.job_instruction_item_evidence_requirements existing
    where existing.id = incoming.id
      and existing.organization_id = p_organization_id
      and existing.instruction_item_id = p_instruction_item_id
  );

  delete from public.job_instruction_item_dependencies existing
  where existing.organization_id = p_organization_id
    and existing.dependent_item_id = p_instruction_item_id
    and not (existing.predecessor_item_id = any(coalesce(p_predecessor_item_ids, '{}'::uuid[])));

  insert into public.job_instruction_item_dependencies (
    organization_id, predecessor_item_id, dependent_item_id, created_by
  )
  select p_organization_id, predecessor_id, p_instruction_item_id, p_actor_id
  from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id
  where not exists (
    select 1
    from public.job_instruction_item_dependencies existing
    where existing.organization_id = p_organization_id
      and existing.predecessor_item_id = predecessor_id
      and existing.dependent_item_id = p_instruction_item_id
  );

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
      join public.job_instruction_items dependent
        on dependent.id = dependency.dependent_item_id
       and dependent.organization_id = p_organization_id
       and dependent.job_id is not distinct from target_job_id
       and dependent.project_id is not distinct from target_project_id
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
  expected_capability_ids uuid[];
  expected_require_confirmations boolean[];
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

  select
    coalesce(array_agg(expected.capability_id order by expected.capability_id), '{}'::uuid[]),
    coalesce(array_agg(expected.require_confirmation order by expected.capability_id), '{}'::boolean[])
  into expected_capability_ids, expected_require_confirmations
  from (
    select
      p_expected_capability_ids[index_value] as capability_id,
      p_expected_require_confirmations[index_value] as require_confirmation
    from generate_subscripts(coalesce(p_expected_capability_ids, '{}'::uuid[]), 1) index_value
  ) expected;

  if current_capability_ids is distinct from expected_capability_ids
    or current_require_confirmations is distinct from expected_require_confirmations then
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

create or replace function app_private.validate_job_material_line_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'job material line job must belong to same organization';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then
    raise exception 'job material line project must belong to same organization';
  end if;
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id and item.organization_id = new.organization_id
  ) then
    raise exception 'job material line item must belong to same organization';
  end if;
  if new.preferred_location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.preferred_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'job material line location must belong to same organization';
  end if;
  if tg_op = 'UPDATE' and (
    old.work_template_application_id is distinct from new.work_template_application_id
    or old.source_work_template_material_line_id is distinct from new.source_work_template_material_line_id
  ) then
    raise exception 'job_material_line_origin_immutable';
  end if;
  if new.work_template_application_id is not null and not exists (
    select 1
    from public.work_template_applications application
    join public.work_template_material_lines source
      on source.id = new.source_work_template_material_line_id
     and source.version_id = application.template_version_id
    where application.id = new.work_template_application_id
      and application.organization_id = new.organization_id
      and application.job_id is not distinct from new.job_id
      and (
        application.project_id is not distinct from new.project_id
        or (
          application.job_id is not null
          and new.project_id is not null
          and exists (
            select 1 from public.jobs job
            where job.id = new.job_id
              and job.organization_id = new.organization_id
              and job.project_id = new.project_id
          )
        )
      )
  ) then
    raise exception 'job_material_line_origin_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.update_instruction_item_details(
  uuid, uuid, uuid, text, text, text, text, jsonb, uuid[]
) from public, anon, authenticated;
revoke all on function public.replace_project_capability_requirements_checked(
  uuid, uuid, uuid[], boolean[], uuid[], boolean[], uuid
) from public, anon, authenticated;
grant execute on function public.update_instruction_item_details(
  uuid, uuid, uuid, text, text, text, text, jsonb, uuid[]
) to service_role;
grant execute on function public.replace_project_capability_requirements_checked(
  uuid, uuid, uuid[], boolean[], uuid[], boolean[], uuid
) to service_role;
revoke all on function app_private.validate_job_material_line_org() from public, anon, authenticated;
