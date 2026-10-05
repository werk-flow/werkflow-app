-- Creating a job or a project is all or nothing. The server actions createJob
-- and createProject inserted the row, then replaced the assignments and
-- applied the work template in further statements, and deleted the new row
-- again when a later step failed. Other sessions could see the half-created
-- work, and a history row written in that window refused the delete, so the
-- action reported rollback_failed and left the work behind.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the template's qualification assessment, and passes only
-- server-resolved values. Each function checks the number and the references
-- under lock and raises the action failure code of the first refusal, so
-- nothing changes. Signals stay
-- as before: the new rows reach the Realtime publication, and the jobs
-- triggers create the planning projection in the same transaction.

-- Inserts a job with its assignments and its work template. p_job holds the
-- job columns of the create form; the job number is required. Runs as the
-- calling function's owner; no role executes it directly. Refusals:
-- invalid_input, title_or_description_required, job_number_required,
-- job_number_taken, project_not_found, the customer reference codes of
-- app_private.assert_work_customer_references, assign_failed, the template
-- codes of app_private.apply_template_to_new_work.
create function app_private.create_job_record(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job jsonb,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean,
  p_template_version_id uuid,
  p_template_assessment boolean
)
returns public.jobs
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields public.jobs;
  v_project public.projects;
  v_job public.jobs;
begin
  perform app_private.work_edit_assignments(p_job, array[
    'title', 'description', 'project_id', 'client_id', 'site_id', 'contact_id', 'job_number',
    'priority', 'planned_date', 'planned_time', 'estimated_duration_minutes',
    'planned_working_minutes', 'location'
  ]);
  v_fields := jsonb_populate_record(null::public.jobs, p_job);

  if coalesce(btrim(v_fields.title), '') = '' and coalesce(btrim(v_fields.description), '') = '' then
    raise exception 'title_or_description_required';
  end if;
  if coalesce(btrim(v_fields.job_number), '') = '' then
    raise exception 'job_number_required';
  end if;

  -- Job numbers have no unique index: one creation per organization checks
  -- and takes a number at a time.
  perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
  if exists (
    select 1 from public.jobs job
    where job.organization_id = p_organization_id and job.job_number = v_fields.job_number
  ) then
    raise exception 'job_number_taken';
  end if;

  -- A project job belongs to the project's customer and inherits the
  -- project's site and contact unless p_job names its own (null clears). The
  -- lock holds the customer until commit against a concurrent project edit.
  if v_fields.project_id is not null then
    select * into v_project from public.projects project
    where project.organization_id = p_organization_id and project.id = v_fields.project_id
    for share;
    if not found then raise exception 'project_not_found'; end if;
    v_fields.client_id := v_project.client_id;
    if not p_job ? 'site_id' then v_fields.site_id := v_project.site_id; end if;
    if not p_job ? 'contact_id' then v_fields.contact_id := v_project.contact_id; end if;
  end if;
  perform app_private.assert_work_customer_references(
    p_organization_id, v_fields.client_id, v_fields.site_id, v_fields.contact_id
  );

  insert into public.jobs (
    organization_id, project_id, client_id, site_id, contact_id, job_number, title, description,
    status, priority, planned_date, planned_time, estimated_duration_minutes,
    planned_working_minutes, location, created_by
  ) values (
    p_organization_id, v_fields.project_id, v_fields.client_id, v_fields.site_id,
    v_fields.contact_id, v_fields.job_number, coalesce(v_fields.title, ''), v_fields.description,
    'nicht_bearbeitet', coalesce(v_fields.priority, 'mittel'), v_fields.planned_date,
    v_fields.planned_time, v_fields.estimated_duration_minutes, v_fields.planned_working_minutes,
    v_fields.location, p_actor_id
  )
  returning * into v_job;

  if coalesce(cardinality(p_selected_user_ids), 0) > 0 then
    begin
      perform public.replace_job_assignments_with_assessment(
        p_organization_id, v_job.id, p_selected_user_ids, p_actor_id, p_assessed_for_date,
        p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
        p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment
      );
    exception when others then
      raise exception 'assign_failed' using detail = sqlerrm;
    end;
  end if;

  if p_template_version_id is not null then
    perform app_private.apply_template_to_new_work(
      p_organization_id, p_actor_id, p_template_version_id, v_job.id, null,
      p_template_assessment, p_assessed_for_date, p_selected_user_ids,
      p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
      p_coverage_fingerprint, p_override_reason, p_team_source_id
    );
  end if;

  return v_job;
end;
$$;

-- Applies a work template to work created in the same transaction. With
-- p_with_assessment the template records the job's qualification assessment.
-- Refusals: work_template_version_unavailable,
-- work_template_reference_unavailable (a material or capability of the
-- template is gone), work_template_qualification_assessment_required,
-- template_apply_failed for any other refusal of apply_work_template.
create function app_private.apply_template_to_new_work(
  p_organization_id uuid,
  p_actor_id uuid,
  p_template_version_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_with_assessment boolean,
  p_assessed_for_date date,
  p_selected_user_ids uuid[],
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_assessed boolean := p_job_id is not null and coalesce(p_with_assessment, false);
begin
  perform public.apply_work_template(
    p_organization_id, p_template_version_id, p_actor_id,
    format('create-%s-%s-%s', case when p_job_id is null then 'project' else 'job' end,
      coalesce(p_job_id, p_project_id), p_template_version_id),
    p_job_id, p_project_id, false,
    case when v_assessed then p_assessed_for_date end,
    case when v_assessed then coalesce(p_selected_user_ids, '{}') end,
    case when v_assessed then coalesce(p_selected_employee_record_ids, '{}') end,
    case when v_assessed then p_requirements_snapshot end,
    case when v_assessed then p_coverage_snapshot end,
    case when v_assessed then p_coverage_fingerprint end,
    case when v_assessed then p_override_reason end,
    case when v_assessed then p_team_source_id end
  );
exception when others then
  if sqlerrm in ('work_template_version_unavailable', 'work_template_reference_unavailable',
    'work_template_qualification_assessment_required') then
    raise exception '%', sqlerrm;
  elsif sqlerrm in ('work_template_material_reference_unavailable',
    'work_template_capability_reference_unavailable') then
    raise exception 'work_template_reference_unavailable' using detail = sqlerrm;
  end if;
  raise exception 'template_apply_failed' using detail = sqlerrm;
end;
$$;

-- Inserts a project with its work template. p_project holds the project
-- columns of the create form; the project number is required. Runs as the
-- calling function's owner; no role executes it directly. Refusals:
-- invalid_input, name_or_description_required, project_number_required,
-- project_number_taken, the customer reference codes, the template codes of
-- app_private.apply_template_to_new_work.
create function app_private.create_project_record(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project jsonb,
  p_template_version_id uuid
)
returns public.projects
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields public.projects;
  v_project public.projects;
begin
  perform app_private.work_edit_assignments(p_project, array[
    'name', 'description', 'client_id', 'site_id', 'contact_id', 'project_number',
    'planned_start_date', 'planned_end_date'
  ]);
  v_fields := jsonb_populate_record(null::public.projects, p_project);

  if coalesce(btrim(v_fields.name), '') = '' and coalesce(btrim(v_fields.description), '') = '' then
    raise exception 'name_or_description_required';
  end if;
  if coalesce(btrim(v_fields.project_number), '') = '' then
    raise exception 'project_number_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_number:' || p_organization_id::text, 0));
  if exists (
    select 1 from public.projects project
    where project.organization_id = p_organization_id
      and project.project_number = v_fields.project_number
  ) then
    raise exception 'project_number_taken';
  end if;
  perform app_private.assert_work_customer_references(
    p_organization_id, v_fields.client_id, v_fields.site_id, v_fields.contact_id
  );

  insert into public.projects (
    organization_id, client_id, site_id, contact_id, name, description, project_number,
    planned_start_date, planned_end_date, created_by
  ) values (
    p_organization_id, v_fields.client_id, v_fields.site_id, v_fields.contact_id,
    coalesce(v_fields.name, ''), v_fields.description, v_fields.project_number,
    v_fields.planned_start_date, v_fields.planned_end_date, p_actor_id
  )
  returning * into v_project;

  if p_template_version_id is not null then
    perform app_private.apply_template_to_new_work(
      p_organization_id, p_actor_id, p_template_version_id, null, v_project.id,
      false, null, null, null, null, null, null, null, null
    );
  end if;

  return v_project;
end;
$$;

-- Creates a job with its assignments and its work template, or nothing.
-- Refusals: those of app_private.create_job_record.
create function public.create_job_with_assignments(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job jsonb,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean,
  p_template_version_id uuid,
  p_template_assessment boolean
)
returns public.jobs
language sql
security definer
set search_path to ''
as $$
  select * from app_private.create_job_record(
    p_organization_id, p_actor_id, p_job, p_selected_user_ids, p_assessed_for_date,
    p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
    p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment,
    p_template_version_id, p_template_assessment
  );
$$;

-- Creates a project with its work template, or nothing. Refusals: those of
-- app_private.create_project_record.
create function public.create_project_with_template(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project jsonb,
  p_template_version_id uuid
)
returns public.projects
language sql
security definer
set search_path to ''
as $$
  select * from app_private.create_project_record(
    p_organization_id, p_actor_id, p_project, p_template_version_id
  );
$$;

revoke all on function app_private.create_job_record(
  uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function app_private.apply_template_to_new_work(
  uuid, uuid, uuid, uuid, uuid, boolean, date, uuid[], uuid[], jsonb, jsonb, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function app_private.create_project_record(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_job_with_assignments(
  uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_job_with_assignments(
  uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
) to service_role;
revoke all on function public.create_project_with_template(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_project_with_template(uuid, uuid, jsonb, uuid)
  to service_role;
