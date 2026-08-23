create or replace function app_private.work_template_dependency_has_cycle(
  p_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive walk(current_item_id, path, has_cycle) as (
    select
      dependency.dependent_item_id,
      array[dependency.predecessor_item_id, dependency.dependent_item_id],
      dependency.predecessor_item_id = dependency.dependent_item_id
    from public.work_template_item_dependencies dependency
    where dependency.version_id = p_version_id

    union all

    select
      dependency.dependent_item_id,
      walk.path || dependency.dependent_item_id,
      dependency.dependent_item_id = any(walk.path)
    from walk
    join public.work_template_item_dependencies dependency
      on dependency.version_id = p_version_id
     and dependency.predecessor_item_id = walk.current_item_id
    where not walk.has_cycle
  )
  select exists (select 1 from walk where has_cycle);
$$;

create or replace function public.create_work_template(
  p_organization_id uuid,
  p_target_type text,
  p_name text,
  p_actor_id uuid,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_id uuid;
  version_id uuid;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if p_target_type not in ('job', 'project') then
    raise exception 'work_template_target_invalid';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'work_template_name_invalid';
  end if;

  insert into public.work_templates (
    organization_id,
    target_type,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    p_target_type,
    p_actor_id,
    p_actor_id
  ) returning id into template_id;

  insert into public.work_template_versions (
    organization_id,
    template_id,
    version_number,
    status,
    name,
    description,
    created_by
  ) values (
    p_organization_id,
    template_id,
    1,
    'draft',
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_actor_id
  ) returning id into version_id;

  update public.work_templates
  set draft_version_id = version_id,
      updated_by = p_actor_id,
      updated_at = now()
  where id = template_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    template_id,
    version_id,
    'created',
    jsonb_build_object('targetType', p_target_type, 'versionNumber', 1),
    p_actor_id
  );

  return template_id;
end;
$$;

create or replace function public.save_work_template_draft(
  p_organization_id uuid,
  p_template_id uuid,
  p_actor_id uuid,
  p_name text,
  p_description text default null,
  p_items jsonb default '[]'::jsonb,
  p_evidence jsonb default '[]'::jsonb,
  p_dependencies jsonb default '[]'::jsonb,
  p_materials jsonb default '[]'::jsonb,
  p_capabilities jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_version_id uuid;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'work_template_name_invalid';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_dependencies, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_capabilities, '[]'::jsonb)) <> 'array' then
    raise exception 'work_template_payload_invalid';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200
    or jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(p_dependencies, '[]'::jsonb)) > 1000
    or jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(p_capabilities, '[]'::jsonb)) > 200 then
    raise exception 'work_template_payload_too_large';
  end if;

  select template.draft_version_id into draft_version_id
  from public.work_templates template
  where template.id = p_template_id
    and template.organization_id = p_organization_id
  for update;
  if draft_version_id is null then
    raise exception 'work_template_draft_not_found';
  end if;

  update public.work_template_versions
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      updated_at = now()
  where id = draft_version_id
    and organization_id = p_organization_id
    and template_id = p_template_id
    and status = 'draft';
  if not found then
    raise exception 'work_template_draft_not_found';
  end if;

  delete from public.work_template_item_dependencies dependency
  where dependency.version_id = draft_version_id;
  delete from public.work_template_item_evidence_requirements evidence
  where evidence.version_id = draft_version_id;
  delete from public.work_template_capability_requirements capability
  where capability.version_id = draft_version_id;
  delete from public.work_template_material_lines material
  where material.version_id = draft_version_id;
  delete from public.work_template_items item
  where item.version_id = draft_version_id;

  insert into public.work_template_items (
    id,
    organization_id,
    version_id,
    item_kind,
    content,
    requirement_state,
    group_label,
    notes,
    sort_order,
    created_by
  )
  select
    item.id,
    p_organization_id,
    draft_version_id,
    item.item_kind,
    btrim(item.content),
    item.requirement_state,
    nullif(btrim(coalesce(item.group_label, '')), ''),
    nullif(btrim(coalesce(item.notes, '')), ''),
    item.sort_order,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    id uuid,
    item_kind text,
    content text,
    requirement_state text,
    group_label text,
    notes text,
    sort_order integer
  );

  insert into public.work_template_item_evidence_requirements (
    id,
    organization_id,
    version_id,
    template_item_id,
    description,
    document_category,
    sort_order,
    created_by
  )
  select
    evidence.id,
    p_organization_id,
    draft_version_id,
    evidence.template_item_id,
    btrim(evidence.description),
    evidence.document_category,
    evidence.sort_order,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) as evidence(
    id uuid,
    template_item_id uuid,
    description text,
    document_category text,
    sort_order integer
  );

  insert into public.work_template_item_dependencies (
    id,
    organization_id,
    version_id,
    predecessor_item_id,
    dependent_item_id,
    created_by
  )
  select
    dependency.id,
    p_organization_id,
    draft_version_id,
    dependency.predecessor_item_id,
    dependency.dependent_item_id,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_dependencies, '[]'::jsonb)) as dependency(
    id uuid,
    predecessor_item_id uuid,
    dependent_item_id uuid
  );

  insert into public.work_template_material_lines (
    id,
    organization_id,
    version_id,
    item_id,
    preferred_location_id,
    planned_quantity,
    is_billable,
    notes,
    sort_order,
    created_by
  )
  select
    material.id,
    p_organization_id,
    draft_version_id,
    material.item_id,
    material.preferred_location_id,
    material.planned_quantity,
    material.is_billable,
    nullif(btrim(coalesce(material.notes, '')), ''),
    material.sort_order,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_materials, '[]'::jsonb)) as material(
    id uuid,
    item_id uuid,
    preferred_location_id uuid,
    planned_quantity numeric,
    is_billable boolean,
    notes text,
    sort_order integer
  );

  insert into public.work_template_capability_requirements (
    id,
    organization_id,
    version_id,
    capability_id,
    require_confirmation,
    sort_order,
    created_by
  )
  select
    capability.id,
    p_organization_id,
    draft_version_id,
    capability.capability_id,
    capability.require_confirmation,
    capability.sort_order,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_capabilities, '[]'::jsonb)) as capability(
    id uuid,
    capability_id uuid,
    require_confirmation boolean,
    sort_order integer
  );

  if app_private.work_template_dependency_has_cycle(draft_version_id) then
    raise exception 'work_template_dependency_cycle';
  end if;

  update public.work_templates
  set updated_by = p_actor_id,
      updated_at = now()
  where id = p_template_id and organization_id = p_organization_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    p_template_id,
    draft_version_id,
    'draft_saved',
    jsonb_build_object(
      'itemCount', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
      'materialCount', jsonb_array_length(coalesce(p_materials, '[]'::jsonb)),
      'capabilityCount', jsonb_array_length(coalesce(p_capabilities, '[]'::jsonb))
    ),
    p_actor_id
  );
  return draft_version_id;
end;
$$;

create or replace function public.publish_work_template(
  p_organization_id uuid,
  p_template_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  version_id uuid;
  version_number integer;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  select template.draft_version_id into version_id
  from public.work_templates template
  where template.id = p_template_id
    and template.organization_id = p_organization_id
  for update;
  if version_id is null then
    raise exception 'work_template_draft_not_found';
  end if;

  select version.version_number into version_number
  from public.work_template_versions version
  where version.id = version_id
    and version.template_id = p_template_id
    and version.organization_id = p_organization_id
    and version.status = 'draft'
  for update;
  if version_number is null then
    raise exception 'work_template_draft_not_found';
  end if;
  if not exists (
    select 1 from public.work_template_items item
    where item.version_id = version_id
  ) then
    raise exception 'work_template_item_required';
  end if;
  if app_private.work_template_dependency_has_cycle(version_id) then
    raise exception 'work_template_dependency_cycle';
  end if;
  if exists (
    select 1
    from public.work_template_material_lines material
    left join public.inventory_items item
      on item.id = material.item_id
     and item.organization_id = p_organization_id
     and item.is_active
     and item.item_type in ('material', 'consumable')
    left join public.inventory_locations location
      on location.id = material.preferred_location_id
     and location.organization_id = p_organization_id
     and location.is_active
    where material.version_id = version_id
      and (
        item.id is null
        or (material.preferred_location_id is not null and location.id is null)
      )
  ) then
    raise exception 'work_template_material_reference_unavailable';
  end if;
  if exists (
    select 1
    from public.work_template_capability_requirements requirement
    left join public.organization_capabilities capability
      on capability.id = requirement.capability_id
     and capability.organization_id = p_organization_id
     and capability.retired_at is null
    where requirement.version_id = version_id
      and capability.id is null
  ) then
    raise exception 'work_template_capability_reference_unavailable';
  end if;

  update public.work_template_versions
  set status = 'published',
      published_by = p_actor_id,
      published_at = now(),
      updated_at = now()
  where id = version_id;

  update public.work_templates
  set draft_version_id = null,
      current_published_version_id = version_id,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_template_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    p_template_id,
    version_id,
    'published',
    jsonb_build_object('versionNumber', version_number),
    p_actor_id
  );
  return version_id;
end;
$$;

create or replace function public.create_work_template_draft(
  p_organization_id uuid,
  p_template_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_version_id uuid;
  new_version_id uuid;
  new_version_number integer;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  select template.current_published_version_id into source_version_id
  from public.work_templates template
  where template.id = p_template_id
    and template.organization_id = p_organization_id
    and template.draft_version_id is null
  for update;
  if source_version_id is null then
    raise exception 'work_template_published_version_not_found';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into new_version_number
  from public.work_template_versions version
  where version.template_id = p_template_id;

  insert into public.work_template_versions (
    organization_id,
    template_id,
    version_number,
    status,
    name,
    description,
    created_by
  )
  select
    p_organization_id,
    p_template_id,
    new_version_number,
    'draft',
    source.name,
    source.description,
    p_actor_id
  from public.work_template_versions source
  where source.id = source_version_id
  returning id into new_version_id;

  insert into public.work_template_items (
    id,
    organization_id,
    version_id,
    copied_from_item_id,
    item_kind,
    content,
    requirement_state,
    group_label,
    notes,
    sort_order,
    created_by
  )
  select
    gen_random_uuid(),
    p_organization_id,
    new_version_id,
    source.id,
    source.item_kind,
    source.content,
    source.requirement_state,
    source.group_label,
    source.notes,
    source.sort_order,
    p_actor_id
  from public.work_template_items source
  where source.version_id = source_version_id
  order by source.sort_order;

  insert into public.work_template_item_evidence_requirements (
    organization_id,
    version_id,
    template_item_id,
    description,
    document_category,
    sort_order,
    created_by
  )
  select
    p_organization_id,
    new_version_id,
    copied.id,
    source.description,
    source.document_category,
    source.sort_order,
    p_actor_id
  from public.work_template_item_evidence_requirements source
  join public.work_template_items copied
    on copied.version_id = new_version_id
   and copied.copied_from_item_id = source.template_item_id
  where source.version_id = source_version_id;

  insert into public.work_template_item_dependencies (
    organization_id,
    version_id,
    predecessor_item_id,
    dependent_item_id,
    created_by
  )
  select
    p_organization_id,
    new_version_id,
    copied_predecessor.id,
    copied_dependent.id,
    p_actor_id
  from public.work_template_item_dependencies source
  join public.work_template_items copied_predecessor
    on copied_predecessor.version_id = new_version_id
   and copied_predecessor.copied_from_item_id = source.predecessor_item_id
  join public.work_template_items copied_dependent
    on copied_dependent.version_id = new_version_id
   and copied_dependent.copied_from_item_id = source.dependent_item_id
  where source.version_id = source_version_id;

  insert into public.work_template_material_lines (
    organization_id,
    version_id,
    item_id,
    preferred_location_id,
    planned_quantity,
    is_billable,
    notes,
    sort_order,
    created_by
  )
  select
    p_organization_id,
    new_version_id,
    source.item_id,
    source.preferred_location_id,
    source.planned_quantity,
    source.is_billable,
    source.notes,
    source.sort_order,
    p_actor_id
  from public.work_template_material_lines source
  where source.version_id = source_version_id;

  insert into public.work_template_capability_requirements (
    organization_id,
    version_id,
    capability_id,
    require_confirmation,
    sort_order,
    created_by
  )
  select
    p_organization_id,
    new_version_id,
    source.capability_id,
    source.require_confirmation,
    source.sort_order,
    p_actor_id
  from public.work_template_capability_requirements source
  where source.version_id = source_version_id;

  update public.work_templates
  set draft_version_id = new_version_id,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_template_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    p_template_id,
    new_version_id,
    'draft_created',
    jsonb_build_object(
      'versionNumber', new_version_number,
      'sourceVersionId', source_version_id
    ),
    p_actor_id
  );
  return new_version_id;
end;
$$;

create or replace function public.set_work_template_archived(
  p_organization_id uuid,
  p_template_id uuid,
  p_actor_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  was_archived boolean;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  select template.archived_at is not null into was_archived
  from public.work_templates template
  where template.id = p_template_id
    and template.organization_id = p_organization_id
  for update;
  if was_archived is null then
    raise exception 'work_template_not_found';
  end if;
  if was_archived = p_archived then
    return;
  end if;

  update public.work_templates
  set archived_at = case when p_archived then now() else null end,
      archived_by = case when p_archived then p_actor_id else null end,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_template_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  )
  select
    p_organization_id,
    p_template_id,
    template.current_published_version_id,
    case when p_archived then 'archived' else 'reactivated' end,
    '{}'::jsonb,
    p_actor_id
  from public.work_templates template
  where template.id = p_template_id;
end;
$$;

create or replace function public.apply_work_template(
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
  application_id uuid;
  template_id uuid;
  template_target_type text;
  template_name text;
  template_version_number integer;
  job_project_id uuid;
  instruction_sort_base integer;
  existing_application_count integer;
  current_assignment_user_ids uuid[];
  item_count integer;
  evidence_count integer;
  dependency_count integer;
  material_count integer;
  capability_count integer;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if num_nonnulls(p_job_id, p_project_id) <> 1 then
    raise exception 'work_template_application_target_invalid';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception 'work_template_idempotency_invalid';
  end if;

  select application.id into application_id
  from public.work_template_applications application
  where application.organization_id = p_organization_id
    and application.idempotency_key = p_idempotency_key;
  if application_id is not null then
    if not exists (
      select 1 from public.work_template_applications application
      where application.id = application_id
        and application.template_version_id = p_template_version_id
        and application.job_id is not distinct from p_job_id
        and application.project_id is not distinct from p_project_id
    ) then
      raise exception 'work_template_idempotency_conflict';
    end if;
    return jsonb_build_object('applicationId', application_id, 'wasCreated', false);
  end if;

  select
    template.id,
    template.target_type,
    version.name,
    version.version_number
  into
    template_id,
    template_target_type,
    template_name,
    template_version_number
  from public.work_template_versions version
  join public.work_templates template on template.id = version.template_id
  where version.id = p_template_version_id
    and version.organization_id = p_organization_id
    and version.status = 'published'
    and template.organization_id = p_organization_id
    and template.archived_at is null;
  if template_id is null then
    raise exception 'work_template_version_unavailable';
  end if;

  if p_job_id is not null then
    if template_target_type <> 'job' then
      raise exception 'work_template_target_mismatch';
    end if;
    select job.project_id into job_project_id
    from public.jobs job
    where job.id = p_job_id
      and job.organization_id = p_organization_id
      and job.status <> 'fertig'
    for update;
    if not found then
      raise exception 'work_template_target_complete_or_missing';
    end if;
  else
    if template_target_type <> 'project' then
      raise exception 'work_template_target_mismatch';
    end if;
    perform 1
    from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
      and not (
        project.status_override = 'abgeschlossen'
        or (
          project.status_override is null
          and exists (
            select 1 from public.jobs child
            where child.project_id = project.id
              and child.organization_id = p_organization_id
          )
          and not exists (
            select 1 from public.jobs child
            where child.project_id = project.id
              and child.organization_id = p_organization_id
              and child.status <> 'fertig'
          )
        )
      )
    for update;
    if not found then
      raise exception 'work_template_target_complete_or_missing';
    end if;
  end if;

  if exists (
    select 1 from public.work_template_applications application
    where application.organization_id = p_organization_id
      and application.template_version_id = p_template_version_id
      and application.job_id is not distinct from p_job_id
      and application.project_id is not distinct from p_project_id
  ) then
    raise exception 'work_template_already_applied';
  end if;

  select count(*) into existing_application_count
  from public.work_template_applications application
  where application.organization_id = p_organization_id
    and application.job_id is not distinct from p_job_id
    and application.project_id is not distinct from p_project_id;
  if existing_application_count > 0 and not p_allow_additional then
    raise exception 'work_template_additional_confirmation_required';
  end if;

  if exists (
    select 1
    from public.work_template_material_lines material
    left join public.inventory_items item
      on item.id = material.item_id
     and item.organization_id = p_organization_id
     and item.is_active
     and item.item_type in ('material', 'consumable')
    left join public.inventory_locations location
      on location.id = material.preferred_location_id
     and location.organization_id = p_organization_id
     and location.is_active
    where material.version_id = p_template_version_id
      and (
        item.id is null
        or (material.preferred_location_id is not null and location.id is null)
      )
  ) then
    raise exception 'work_template_material_reference_unavailable';
  end if;
  if exists (
    select 1
    from public.work_template_capability_requirements requirement
    left join public.organization_capabilities capability
      on capability.id = requirement.capability_id
     and capability.organization_id = p_organization_id
     and capability.retired_at is null
    where requirement.version_id = p_template_version_id
      and capability.id is null
  ) then
    raise exception 'work_template_capability_reference_unavailable';
  end if;

  select count(*) into capability_count
  from public.work_template_capability_requirements requirement
  where requirement.version_id = p_template_version_id;
  if p_job_id is not null and capability_count > 0 then
    if p_assessed_for_date is null
      or p_selected_user_ids is null
      or p_selected_employee_record_ids is null
      or p_requirements_snapshot is null
      or p_coverage_snapshot is null
      or length(btrim(coalesce(p_coverage_fingerprint, ''))) = 0 then
      raise exception 'work_template_qualification_assessment_required';
    end if;
    select coalesce(array_agg(assignment.user_id order by assignment.user_id), '{}'::uuid[])
    into current_assignment_user_ids
    from public.job_assignments assignment
    where assignment.job_id = p_job_id;
    if current_assignment_user_ids <> (
      select coalesce(array_agg(distinct selected_user_id order by selected_user_id), '{}'::uuid[])
      from unnest(p_selected_user_ids) selected_user_id
    ) then
      raise exception 'work_template_qualification_assessment_stale';
    end if;
    if p_team_source_id is not null and not exists (
      select 1 from public.teams team
      where team.id = p_team_source_id
        and team.organization_id = p_organization_id
    ) then
      raise exception 'work_template_team_source_mismatch';
    end if;
  end if;

  insert into public.work_template_applications (
    organization_id,
    template_id,
    template_version_id,
    job_id,
    project_id,
    idempotency_key,
    applied_by
  ) values (
    p_organization_id,
    template_id,
    p_template_version_id,
    p_job_id,
    p_project_id,
    btrim(p_idempotency_key),
    p_actor_id
  ) returning id into application_id;

  select coalesce(max(item.sort_order), -1) into instruction_sort_base
  from public.job_instruction_items item
  where item.job_id is not distinct from p_job_id
    and item.project_id is not distinct from p_project_id;

  insert into public.job_instruction_items (
    organization_id,
    job_id,
    project_id,
    content,
    sort_order,
    is_completed,
    created_by,
    item_kind,
    requirement_state,
    group_label,
    notes,
    work_template_application_id,
    source_work_template_item_id
  )
  select
    p_organization_id,
    p_job_id,
    p_project_id,
    template_item.content,
    instruction_sort_base + template_item.sort_order + 1,
    false,
    p_actor_id,
    template_item.item_kind,
    template_item.requirement_state,
    template_item.group_label,
    template_item.notes,
    application_id,
    template_item.id
  from public.work_template_items template_item
  where template_item.version_id = p_template_version_id
  order by template_item.sort_order;

  insert into public.job_instruction_item_evidence_requirements (
    organization_id,
    instruction_item_id,
    description,
    document_category,
    sort_order,
    work_template_application_id,
    source_work_template_evidence_id,
    created_by,
    updated_by
  )
  select
    p_organization_id,
    instruction_item.id,
    evidence.description,
    evidence.document_category,
    evidence.sort_order,
    application_id,
    evidence.id,
    p_actor_id,
    p_actor_id
  from public.work_template_item_evidence_requirements evidence
  join public.job_instruction_items instruction_item
    on instruction_item.work_template_application_id = application_id
   and instruction_item.source_work_template_item_id = evidence.template_item_id
  where evidence.version_id = p_template_version_id;

  insert into public.job_instruction_item_dependencies (
    organization_id,
    predecessor_item_id,
    dependent_item_id,
    work_template_application_id,
    source_work_template_dependency_id,
    created_by
  )
  select
    p_organization_id,
    predecessor.id,
    dependent.id,
    application_id,
    dependency.id,
    p_actor_id
  from public.work_template_item_dependencies dependency
  join public.job_instruction_items predecessor
    on predecessor.work_template_application_id = application_id
   and predecessor.source_work_template_item_id = dependency.predecessor_item_id
  join public.job_instruction_items dependent
    on dependent.work_template_application_id = application_id
   and dependent.source_work_template_item_id = dependency.dependent_item_id
  where dependency.version_id = p_template_version_id;

  insert into public.job_material_lines (
    organization_id,
    job_id,
    project_id,
    item_id,
    preferred_location_id,
    planned_quantity,
    is_billable,
    notes,
    created_by,
    work_template_application_id,
    source_work_template_material_line_id
  )
  select
    p_organization_id,
    p_job_id,
    case when p_job_id is not null then job_project_id else p_project_id end,
    material.item_id,
    material.preferred_location_id,
    material.planned_quantity,
    material.is_billable,
    material.notes,
    p_actor_id,
    application_id,
    material.id
  from public.work_template_material_lines material
  where material.version_id = p_template_version_id
  order by material.sort_order;

  if p_job_id is not null then
    insert into public.job_capability_requirements (
      organization_id,
      job_id,
      project_id,
      capability_id,
      require_confirmation,
      created_by,
      updated_by
    )
    select
      p_organization_id,
      p_job_id,
      null,
      template_requirement.capability_id,
      template_requirement.require_confirmation,
      p_actor_id,
      p_actor_id
    from public.work_template_capability_requirements template_requirement
    where template_requirement.version_id = p_template_version_id
    on conflict (job_id, capability_id) where job_id is not null
    do update set
      require_confirmation = job_capability_requirements.require_confirmation
        or excluded.require_confirmation,
      updated_by = excluded.updated_by,
      updated_at = now();

    insert into public.job_capability_requirement_origins (
      organization_id,
      requirement_id,
      work_template_application_id,
      source_work_template_requirement_id
    )
    select
      p_organization_id,
      requirement.id,
      application_id,
      template_requirement.id
    from public.work_template_capability_requirements template_requirement
    join public.job_capability_requirements requirement
      on requirement.organization_id = p_organization_id
     and requirement.job_id = p_job_id
     and requirement.capability_id = template_requirement.capability_id
    where template_requirement.version_id = p_template_version_id;

    if capability_count > 0 then
      insert into public.job_qualification_assessments (
        organization_id,
        job_id,
        assessed_for_date,
        selected_user_ids,
        selected_employee_record_ids,
        requirements_snapshot,
        coverage_snapshot,
        coverage_fingerprint,
        override_reason,
        team_source_id,
        created_by
      ) values (
        p_organization_id,
        p_job_id,
        p_assessed_for_date,
        p_selected_user_ids,
        p_selected_employee_record_ids,
        p_requirements_snapshot,
        p_coverage_snapshot,
        p_coverage_fingerprint,
        nullif(btrim(coalesce(p_override_reason, '')), ''),
        p_team_source_id,
        p_actor_id
      );
    end if;
  else
    insert into public.job_capability_requirements (
      organization_id,
      job_id,
      project_id,
      capability_id,
      require_confirmation,
      created_by,
      updated_by
    )
    select
      p_organization_id,
      null,
      p_project_id,
      template_requirement.capability_id,
      template_requirement.require_confirmation,
      p_actor_id,
      p_actor_id
    from public.work_template_capability_requirements template_requirement
    where template_requirement.version_id = p_template_version_id
    on conflict (project_id, capability_id) where project_id is not null
    do update set
      require_confirmation = job_capability_requirements.require_confirmation
        or excluded.require_confirmation,
      updated_by = excluded.updated_by,
      updated_at = now();

    insert into public.job_capability_requirement_origins (
      organization_id,
      requirement_id,
      work_template_application_id,
      source_work_template_requirement_id
    )
    select
      p_organization_id,
      requirement.id,
      application_id,
      template_requirement.id
    from public.work_template_capability_requirements template_requirement
    join public.job_capability_requirements requirement
      on requirement.organization_id = p_organization_id
     and requirement.project_id = p_project_id
     and requirement.capability_id = template_requirement.capability_id
    where template_requirement.version_id = p_template_version_id;
  end if;

  select count(*) into item_count
  from public.work_template_items item
  where item.version_id = p_template_version_id;
  select count(*) into evidence_count
  from public.work_template_item_evidence_requirements evidence
  where evidence.version_id = p_template_version_id;
  select count(*) into dependency_count
  from public.work_template_item_dependencies dependency
  where dependency.version_id = p_template_version_id;
  select count(*) into material_count
  from public.work_template_material_lines material
  where material.version_id = p_template_version_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    application_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    template_id,
    p_template_version_id,
    application_id,
    'applied',
    jsonb_build_object(
      'jobId', p_job_id,
      'projectId', p_project_id,
      'versionNumber', template_version_number,
      'templateName', template_name,
      'itemCount', item_count,
      'evidenceCount', evidence_count,
      'dependencyCount', dependency_count,
      'materialCount', material_count,
      'capabilityCount', capability_count
    ),
    p_actor_id
  );

  return jsonb_build_object(
    'applicationId', application_id,
    'wasCreated', true,
    'itemCount', item_count,
    'evidenceCount', evidence_count,
    'dependencyCount', dependency_count,
    'materialCount', material_count,
    'capabilityCount', capability_count
  );
end;
$$;

create or replace function public.replace_job_capability_requirements(
  p_organization_id uuid,
  p_job_id uuid,
  p_capability_ids uuid[],
  p_require_confirmations boolean[],
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_capability_ids uuid[];
begin
  if cardinality(coalesce(p_capability_ids, '{}'::uuid[])) <>
     cardinality(coalesce(p_require_confirmations, '{}'::boolean[])) then
    raise exception 'requirement array length mismatch';
  end if;
  if not exists (
    select 1 from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id
  ) then
    raise exception 'job organization mismatch';
  end if;
  select coalesce(array_agg(distinct capability_id order by capability_id), '{}'::uuid[])
  into normalized_capability_ids
  from unnest(coalesce(p_capability_ids, '{}'::uuid[])) capability_id;
  if cardinality(normalized_capability_ids) <>
     cardinality(coalesce(p_capability_ids, '{}'::uuid[])) then
    raise exception 'duplicate capability requirement';
  end if;
  if (
    select count(*)
    from public.organization_capabilities capability
    where capability.organization_id = p_organization_id
      and capability.retired_at is null
      and capability.id = any(normalized_capability_ids)
  ) <> cardinality(normalized_capability_ids) then
    raise exception 'capability organization mismatch or retired';
  end if;

  delete from public.job_capability_requirements requirement
  where requirement.organization_id = p_organization_id
    and requirement.job_id = p_job_id
    and not (requirement.capability_id = any(normalized_capability_ids));

  insert into public.job_capability_requirements (
    organization_id,
    job_id,
    project_id,
    capability_id,
    require_confirmation,
    created_by,
    updated_by
  )
  select
    p_organization_id,
    p_job_id,
    null,
    p_capability_ids[index_value],
    p_require_confirmations[index_value],
    p_actor_id,
    p_actor_id
  from generate_subscripts(coalesce(p_capability_ids, '{}'::uuid[]), 1) index_value
  on conflict (job_id, capability_id) where job_id is not null
  do update set
    require_confirmation = excluded.require_confirmation,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;

create or replace function public.replace_project_capability_requirements(
  p_organization_id uuid,
  p_project_id uuid,
  p_capability_ids uuid[],
  p_require_confirmations boolean[],
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_capability_ids uuid[];
begin
  if cardinality(coalesce(p_capability_ids, '{}'::uuid[])) <>
     cardinality(coalesce(p_require_confirmations, '{}'::boolean[])) then
    raise exception 'requirement array length mismatch';
  end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id
  ) then
    raise exception 'project organization mismatch';
  end if;
  select coalesce(array_agg(distinct capability_id order by capability_id), '{}'::uuid[])
  into normalized_capability_ids
  from unnest(coalesce(p_capability_ids, '{}'::uuid[])) capability_id;
  if cardinality(normalized_capability_ids) <>
     cardinality(coalesce(p_capability_ids, '{}'::uuid[])) then
    raise exception 'duplicate capability requirement';
  end if;
  if (
    select count(*)
    from public.organization_capabilities capability
    where capability.organization_id = p_organization_id
      and capability.retired_at is null
      and capability.id = any(normalized_capability_ids)
  ) <> cardinality(normalized_capability_ids) then
    raise exception 'capability organization mismatch or retired';
  end if;

  delete from public.job_capability_requirements requirement
  where requirement.organization_id = p_organization_id
    and requirement.project_id = p_project_id
    and not (requirement.capability_id = any(normalized_capability_ids));

  insert into public.job_capability_requirements (
    organization_id,
    job_id,
    project_id,
    capability_id,
    require_confirmation,
    created_by,
    updated_by
  )
  select
    p_organization_id,
    null,
    p_project_id,
    p_capability_ids[index_value],
    p_require_confirmations[index_value],
    p_actor_id,
    p_actor_id
  from generate_subscripts(coalesce(p_capability_ids, '{}'::uuid[]), 1) index_value
  on conflict (project_id, capability_id) where project_id is not null
  do update set
    require_confirmation = excluded.require_confirmation,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;

revoke all on function app_private.work_template_dependency_has_cycle(uuid)
  from public, anon, authenticated;
revoke all on function public.create_work_template(uuid, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_work_template_draft(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.publish_work_template(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_work_template_draft(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_work_template_archived(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.apply_work_template(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[], jsonb,
  jsonb, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.replace_job_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) from public, anon, authenticated;
revoke all on function public.replace_project_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) from public, anon, authenticated;

grant execute on function public.create_work_template(uuid, text, text, uuid, text)
  to service_role;
grant execute on function public.save_work_template_draft(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.publish_work_template(uuid, uuid, uuid)
  to service_role;
grant execute on function public.create_work_template_draft(uuid, uuid, uuid)
  to service_role;
grant execute on function public.set_work_template_archived(uuid, uuid, uuid, boolean)
  to service_role;
grant execute on function public.apply_work_template(
  uuid, uuid, uuid, text, uuid, uuid, boolean, date, uuid[], uuid[], jsonb,
  jsonb, text, text, uuid
) to service_role;
grant execute on function public.replace_job_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) to service_role;
grant execute on function public.replace_project_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) to service_role;
