-- Moving a job to another project moves its material lines with it
-- (werk-flow/werkflow-planning#411).
--
-- A job's material line stores the job's project in
-- job_material_lines.project_id, which the project's material summary reads.
-- update_job_with_assignments changed the job's project and left its lines on
-- the previous one, so the previous project kept showing the job's material
-- and the new project omitted it.
--
-- 1. update_job_with_assignments, the one function that moves a job between
--    projects, sets the new project, or none, on every line of the job in the
--    same transaction. Its row lock on the job (for no key update) conflicts
--    with the lock that plan_job_material, take_unplanned_inventory_material
--    and apply_work_template take on the job before they write a line, so a
--    line planned concurrently ends on the job's final project: a writer that
--    locked first commits its line before the move updates it, and a writer
--    that waits reads the moved job. Signature, result, owner, security
--    definer and grants stay as before; the rest of the body is unchanged.
-- 2. Lines that an earlier move left on the previous project take their job's
--    project now, unless that project lies outside the line's organization,
--    which the line's organization check would refuse. The repair locks those
--    jobs before it reads their projects, so a move committed meanwhile wins.
--
-- inventory_movements and job_material_use_events keep the project they were
-- booked with: they are history. A project's own lines (no job) do not move.
-- Deleting a project still deletes the lines that carry it, as before.

-- Saves the named job columns and, when asked, replaces the assignments with
-- their qualification assessment through replace_job_assignments_with_assessment.
-- Refusals: invalid_input, job_not_found, title_or_description_required,
-- project_not_found, job_number_taken, the customer reference codes of
-- update_project_with_jobs; a refused assignment raises that function's error.
-- A job that changes its project takes its material lines along.
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
  v_previous_project_id uuid;
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
  v_previous_project_id := v_job.project_id;

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
    -- Every function that adds a line to a job locks the job row first, so
    -- this update reaches every line of the job.
    if v_job.project_id is distinct from v_previous_project_id then
      update public.job_material_lines line
      set project_id = v_job.project_id
      where line.organization_id = p_organization_id and line.job_id = p_job_id;
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

do $$
begin
  -- The jobs first, in the order the job edit locks: a move of one of them
  -- waits, and the update reads each job's project after the locks.
  perform 1 from public.jobs job
  where exists (
    select 1 from public.job_material_lines line
    where line.job_id = job.id and line.project_id is distinct from job.project_id
  )
  order by job.id
  for share;

  update public.job_material_lines line
  set project_id = job.project_id
  from public.jobs job
  where job.id = line.job_id
    and job.organization_id = line.organization_id
    and line.project_id is distinct from job.project_id
    and (job.project_id is null or exists (
      select 1 from public.projects project
      where project.id = job.project_id and project.organization_id = line.organization_id
    ));
end $$;
