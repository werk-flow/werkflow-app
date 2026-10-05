-- Unparking a job into the schedule is all or nothing (P1-24a, criterion 26).
-- The server action unparkJobIntoSchedule in lib/work-lifecycle/actions.ts
-- called unpark_work_target, then update_job_with_assignments, and re-parked
-- the job with a third call when the schedule write failed; a failed re-park
-- left the job unparked without a plan. Both steps now run in one function
-- call, and so in one transaction.
--
-- Division of work: the action establishes identity, organization and the
-- planning role, assesses the qualifications of the selection before the call
-- (a warning returns with nothing changed), and passes the arguments that
-- prepareJobUpdate (lib/jobs/update-preparation.ts) built for
-- update_job_with_assignments. The function locks the job, runs the existing
-- unpark and the existing edit, and raises their refusal codes; the first
-- refusal rolls both back, so the job stays parked with its open blocker.
--
-- The unpark sets the job status from its execution state. The edit's status
-- change (a parked legacy row taken back into the plan) belongs to an edit
-- without an unpark, so it is dropped here.
--
-- Signals stay as before: the blocker, its event row, the job and its
-- assignments change through the same functions and tables.
create function public.unpark_job_into_schedule(
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
begin
  -- The job first, as park_work_target locks it, then the unpark locks the blocker.
  perform 1 from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for update;
  if not found then raise exception 'job_not_found'; end if;

  perform public.unpark_work_target(
    p_organization_id, p_actor_id, 'job', p_job_id, p_expected_blocker_version, p_reason
  );

  return public.update_job_with_assignments(
    p_organization_id, p_job_id, p_actor_id, coalesce(p_changes, '{}'::jsonb) - 'status',
    p_replace_assignments, p_selected_user_ids, p_assessed_for_date, p_selected_employee_record_ids,
    p_requirements_snapshot, p_coverage_snapshot, p_coverage_fingerprint, p_override_reason,
    p_team_source_id, p_record_assessment
  );
end;
$$;

revoke all on function public.unpark_job_into_schedule(
  uuid, uuid, uuid, bigint, text, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.unpark_job_into_schedule(
  uuid, uuid, uuid, bigint, text, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) to service_role;
