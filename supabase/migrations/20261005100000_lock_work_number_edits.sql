-- A changed job or project number is checked under the organization's number
-- lock. The creation functions (20261004170000_create_work_atomically.sql,
-- 20261004170200_create_maintenance_visits_atomically.sql) take that lock
-- before they check and take a number, because the numbers have no unique
-- index; the edit functions of 20261004150000_apply_work_edits_atomically.sql
-- checked without it, so a concurrent creation and edit could both take the
-- same number. The bodies are unchanged apart from the lock, which is taken
-- only when the edit names a different number. Owner, security definer and
-- the grants stay as they are.

-- Saves the named project columns and, when the customer changes, moves every
-- job of the project to the new customer without the previous customer's site
-- and contact. Refusals: invalid_input, project_not_found,
-- name_or_description_required, project_number_taken, client_not_found,
-- site_requires_client, site_not_found, site_client_mismatch,
-- contact_requires_client, contact_not_found, contact_client_mismatch.
create or replace function public.update_project_with_jobs(
  p_organization_id uuid,
  p_project_id uuid,
  p_changes jsonb
)
returns public.projects
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'name', 'description', 'client_id', 'site_id', 'contact_id', 'project_number',
    'planned_start_date', 'planned_end_date'
  ]);
  v_previous_client_id uuid;
  v_previous_project_number text;
  v_project public.projects;
begin
  if v_assignments is null then raise exception 'invalid_input'; end if;

  select project.client_id, project.project_number
  into v_previous_client_id, v_previous_project_number
  from public.projects project
  where project.organization_id = p_organization_id and project.id = p_project_id
  for no key update;
  if not found then raise exception 'project_not_found'; end if;

  -- A new number waits for the creations and edits that check and take one
  -- (app_private.create_project_record takes the same lock); the check below runs
  -- after it.
  if p_changes ? 'project_number'
    and p_changes ->> 'project_number' is distinct from v_previous_project_number then
    perform pg_advisory_xact_lock(hashtextextended('project_number:' || p_organization_id::text, 0));
  end if;

  execute format(
    'update public.projects project set %s
     from jsonb_populate_record(null::public.projects, $1) changes
     where project.organization_id = $2 and project.id = $3
     returning project.*',
    v_assignments
  ) into v_project using p_changes, p_organization_id, p_project_id;

  if btrim(v_project.name) = '' and coalesce(btrim(v_project.description), '') = '' then
    raise exception 'name_or_description_required';
  end if;
  if p_changes ? 'project_number' and v_project.project_number is not null and exists (
    select 1 from public.projects other
    where other.organization_id = p_organization_id
      and other.project_number = v_project.project_number
      and other.id <> p_project_id
  ) then
    raise exception 'project_number_taken';
  end if;
  if p_changes ?| array['client_id', 'site_id', 'contact_id'] then
    perform app_private.assert_work_customer_references(
      p_organization_id, v_project.client_id, v_project.site_id, v_project.contact_id
    );
  end if;

  -- The previous customer's sites and contacts no longer fit the jobs.
  if v_project.client_id is distinct from v_previous_client_id then
    update public.jobs job
    set client_id = v_project.client_id, site_id = null, contact_id = null
    where job.organization_id = p_organization_id and job.project_id = p_project_id;
  end if;

  return v_project;
end;
$$;

-- Saves the named job columns and, when asked, replaces the assignments with
-- their qualification assessment through replace_job_assignments_with_assessment.
-- Refusals: invalid_input, job_not_found, title_or_description_required,
-- project_not_found, job_number_taken, the customer reference codes of
-- update_project_with_jobs; a refused assignment raises that function's error.
create or replace function public.update_job_with_assignments(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_changes jsonb,
  p_replace_assignments boolean,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean
)
returns public.jobs
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'title', 'description', 'project_id', 'client_id', 'site_id', 'contact_id', 'job_number',
    'priority', 'planned_date', 'planned_time', 'estimated_duration_minutes',
    'planned_working_minutes', 'location', 'status'
  ]);
  v_job public.jobs;
begin
  -- An edit only takes a parked job back into the plan; every other status
  -- change has its own workflow.
  if p_changes ? 'status' and p_changes ->> 'status' is distinct from 'nicht_bearbeitet' then
    raise exception 'invalid_input';
  end if;
  if v_assignments is null and not coalesce(p_replace_assignments, false) then
    raise exception 'invalid_input';
  end if;

  select * into v_job from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for no key update;
  if not found then raise exception 'job_not_found'; end if;

  -- A new number waits for the creations and edits that check and take one
  -- (app_private.create_job_record takes the same lock); the check below runs
  -- after it.
  if p_changes ? 'job_number' and p_changes ->> 'job_number' is distinct from v_job.job_number then
    perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
  end if;

  if v_assignments is not null then
    execute format(
      'update public.jobs job set %s
       from jsonb_populate_record(null::public.jobs, $1) changes
       where job.organization_id = $2 and job.id = $3
       returning job.*',
      v_assignments
    ) into v_job using p_changes, p_organization_id, p_job_id;

    if btrim(v_job.title) = '' and coalesce(btrim(v_job.description), '') = '' then
      raise exception 'title_or_description_required';
    end if;
    if v_job.project_id is not null and p_changes ? 'project_id' and not exists (
      select 1 from public.projects project
      where project.organization_id = p_organization_id and project.id = v_job.project_id
    ) then
      raise exception 'project_not_found';
    end if;
    if p_changes ? 'job_number' and v_job.job_number is not null and exists (
      select 1 from public.jobs other
      where other.organization_id = p_organization_id
        and other.job_number = v_job.job_number
        and other.id <> p_job_id
    ) then
      raise exception 'job_number_taken';
    end if;
    if p_changes ?| array['project_id', 'client_id', 'site_id', 'contact_id'] then
      perform app_private.assert_work_customer_references(
        p_organization_id, v_job.client_id, v_job.site_id, v_job.contact_id
      );
    end if;
  end if;

  if coalesce(p_replace_assignments, false) then
    perform public.replace_job_assignments_with_assessment(
      p_organization_id, p_job_id, p_selected_user_ids, p_actor_id, p_assessed_for_date,
      p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
      p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment
    );
  end if;

  return v_job;
end;
$$;
