-- Turning an Anfrage into an Auftrag and planning a parked job from the
-- calendar record the capacity assessment of the visit they plan, in the same
-- call that writes the job.
--
-- Both write a job's schedule columns together with its team, so
-- app_private.sync_legacy_job_planning_occurrence plans the job's legacy
-- visit and the team triggers put the people on it. unpark_job_into_schedule
-- then puts every person of the job's team on that visit. Both saved the
-- visit without the capacity check every planning write runs, so a person who
-- left, was on vacation or was already planned that day was planned without a
-- warning (werk-flow/werkflow-planning#304). The server now predicts the
-- visit the save leaves, assesses it as the calendar does and refuses a
-- conflict without a reason. These functions run the unchanged write, then
-- app_private.record_job_visit_assessment (migration 20261124100000) checks
-- that the visit it left is the one the server assessed, and stores what the
-- manager confirmed. A visit that is not the assessed one, or a save that
-- planned people without an assessment, is stale_planning_occurrence and
-- rolls back the whole write: the request stays open, the job stays parked.
--
-- Expand-only: new functions. convert_client_request_to_job and
-- unpark_job_into_schedule keep their signatures and bodies, so the previous
-- release works unchanged. supabase/tests/job_plan_bridge.sql holds the rules.

create function public.convert_client_request_to_job_with_visit_assessment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
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
  p_template_assessment boolean,
  p_visit_assessment jsonb
)
returns public.jobs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job public.jobs;
begin
  v_job := public.convert_client_request_to_job(
    p_organization_id, p_actor_id, p_request_id, p_job, p_selected_user_ids, p_assessed_for_date,
    p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
    p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment,
    p_template_version_id, p_template_assessment
  );
  -- The new job had no visit before this call.
  perform app_private.record_job_visit_assessment(
    p_organization_id, v_job.id, p_actor_id, null, '{}'::uuid[], p_visit_assessment
  );
  return v_job;
end;
$function$;

revoke all on function public.convert_client_request_to_job_with_visit_assessment(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.convert_client_request_to_job_with_visit_assessment(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb
) to service_role;

create function public.unpark_job_into_schedule_with_visit_assessment(
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
  p_record_assessment boolean,
  p_visit_assessment jsonb
)
returns public.jobs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job public.jobs;
  v_before_version integer;
  v_before_crew uuid[];
begin
  -- The job row first, as unpark_job_into_schedule and park_work_target lock
  -- it, so two writes of one job run in turn. The visit is read without a
  -- lock: the calendar locks a visit before its job, so locking it here could
  -- deadlock. A visit changed between this read and the write reads as
  -- changed by the save and is refused as stale, never passed unassessed.
  perform 1
  from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  select
    occurrence.version,
    coalesce(array(
      select assignment.employee_record_id
      from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = occurrence.id
      order by assignment.employee_record_id
    ), '{}'::uuid[])
  into v_before_version, v_before_crew
  from public.planning_occurrences occurrence
  where occurrence.organization_id = p_organization_id
    and occurrence.legacy_source_job_id = p_job_id;

  v_job := public.unpark_job_into_schedule(
    p_organization_id, p_actor_id, p_job_id, p_expected_blocker_version, p_reason, p_changes,
    p_replace_assignments, p_selected_user_ids, p_assessed_for_date, p_selected_employee_record_ids,
    p_requirements_snapshot, p_coverage_snapshot, p_coverage_fingerprint, p_override_reason,
    p_team_source_id, p_record_assessment
  );
  perform app_private.record_job_visit_assessment(
    p_organization_id, p_job_id, p_actor_id, v_before_version,
    coalesce(v_before_crew, '{}'::uuid[]), p_visit_assessment
  );
  return v_job;
end;
$function$;

revoke all on function public.unpark_job_into_schedule_with_visit_assessment(
  uuid, uuid, uuid, bigint, text, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.unpark_job_into_schedule_with_visit_assessment(
  uuid, uuid, uuid, bigint, text, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, jsonb
) to service_role;
