-- A job that returns from the Parkplatz into the plan is planned for the
-- people the manager selected.
--
-- The visit of a job mirrors job_assignments row by row
-- (app_private.sync_legacy_job_assignment runs on insert and delete). A
-- calendar move of the visit to another person adds that person to the job
-- and leaves the earlier person on the job, off the visit
-- (update_planning_occurrence only adds). When such a job was parked and then
-- dropped on the earlier person's row, the assignment replacement inserted
-- nothing, so nothing reached the visit: the calendar confirmed the plan for
-- that person and showed the visit only in the other row.
--
-- unpark_job_into_schedule now completes the visit from the job's assignments
-- after the edit, in the same transaction. The visit never holds a person the
-- job does not, because the delete trigger removes them, so adding the missing
-- people makes the visit equal the selection. Signature, grants and refusals
-- stay as migration 20261004170300 set them.
create or replace function public.unpark_job_into_schedule(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_blocker_version bigint,
  p_reason text,
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
  v_job public.jobs;
begin
  -- The job first, as park_work_target locks it, then the unpark locks the blocker.
  perform 1 from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for update;
  if not found then raise exception 'job_not_found'; end if;

  perform public.unpark_work_target(
    p_organization_id, p_actor_id, 'job', p_job_id, p_expected_blocker_version, p_reason
  );

  v_job := public.update_job_with_assignments(
    p_organization_id, p_job_id, p_actor_id, coalesce(p_changes, '{}'::jsonb) - 'status',
    p_replace_assignments, p_selected_user_ids, p_assessed_for_date, p_selected_employee_record_ids,
    p_requirements_snapshot, p_coverage_snapshot, p_coverage_fingerprint, p_override_reason,
    p_team_source_id, p_record_assessment
  );

  if coalesce(p_replace_assignments, false) then
    insert into public.planning_occurrence_assignments (
      organization_id, occurrence_id, employee_record_id, assigned_by, assigned_at
    )
    select p_organization_id, occurrence.id, employee.id, p_actor_id, now()
    from public.planning_occurrences occurrence
    join public.job_assignments assignment on assignment.job_id = occurrence.legacy_source_job_id
    join public.employee_records employee
      on employee.organization_id = p_organization_id and employee.user_id = assignment.user_id
    where occurrence.organization_id = p_organization_id
      and occurrence.legacy_source_job_id = p_job_id
      and occurrence.status = 'scheduled'
    on conflict (occurrence_id, employee_record_id) do nothing;
  end if;

  return v_job;
end;
$$;
