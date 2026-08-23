-- Explicit final definition; supersedes the earlier formatting-dependent repair.
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
        project.status_override is not distinct from 'abgeschlossen'
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
