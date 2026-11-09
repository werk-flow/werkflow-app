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
-- A visit that started is history for the team triggers, so a job created
-- or converted for today leaves its visit without people. The unpark puts the
-- team on the revived visit all the same, also for today, so its check covers
-- a started visit too: record_job_visit_assessment gets a variant that says
-- so, and the existing six-argument function runs it unchanged.
--
-- Expand-only: new functions. convert_client_request_to_job and
-- unpark_job_into_schedule keep their signatures and bodies, so the previous
-- release works unchanged. supabase/tests/job_plan_bridge.sql holds the rules.

create function app_private.record_job_visit_assessment(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_before_version integer,
  p_before_employee_record_ids uuid[],
  p_visit_assessment jsonb,
  p_started_visit_planned boolean
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_visit public.planning_occurrences%rowtype;
  v_crew uuid[];
  v_unstarted boolean;
  v_assessed record;
  v_operation_assessment_id uuid;
begin
  select * into v_visit
  from public.planning_occurrences occurrence
  where occurrence.organization_id = p_organization_id
    and occurrence.legacy_source_job_id = p_job_id;

  v_crew := coalesce(array(
    select assignment.employee_record_id
    from public.planning_occurrence_assignments assignment
    where assignment.occurrence_id = v_visit.id
    order by assignment.employee_record_id
  ), '{}'::uuid[]);
  -- The rule of app_private.sync_legacy_job_assignment: a visit that started
  -- is history, unless the write puts people on it all the same.
  v_unstarted := v_visit.id is not null
    and v_visit.status = 'scheduled'
    and (
      p_started_visit_planned
      or coalesce(
        v_visit.start_at > now(),
        v_visit.start_date > (now() at time zone 'Europe/Berlin')::date,
        false
      )
    );

  if p_visit_assessment is null then
    if v_unstarted
       and cardinality(v_crew) > 0
       and (
         v_visit.version is distinct from p_before_version
         or not (v_crew <@ coalesce(p_before_employee_record_ids, '{}'::uuid[]))
       ) then
      raise exception 'stale_planning_occurrence';
    end if;
    return;
  end if;

  select * into v_assessed
  from jsonb_to_record(p_visit_assessment) as assessed(
    employee_record_ids uuid[],
    start_at timestamptz,
    end_at timestamptz,
    start_date date,
    end_date_exclusive date,
    capacity_snapshot jsonb,
    capacity_fingerprint text,
    qualification_snapshot jsonb,
    qualification_fingerprint text,
    override_reason text
  );

  if not v_unstarted
     or v_crew <> coalesce(array(
       select distinct assessed_record_id
       from unnest(v_assessed.employee_record_ids) as assessed_record_id
       order by assessed_record_id
     ), '{}'::uuid[])
     or v_visit.start_at is distinct from v_assessed.start_at
     or v_visit.end_at is distinct from v_assessed.end_at
     or v_visit.start_date is distinct from v_assessed.start_date
     or v_visit.end_date_exclusive is distinct from v_assessed.end_date_exclusive
     or v_assessed.capacity_fingerprint is null
     or v_assessed.qualification_fingerprint is null then
    raise exception 'stale_planning_occurrence';
  end if;

  v_operation_assessment_id := app_private.record_planning_operation_assessment(
    p_organization_id, p_actor_id, v_assessed.capacity_snapshot, v_assessed.qualification_snapshot
  );

  insert into public.planning_occurrence_assessments (
    organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
    operation_assessment_id, capacity_fingerprint,
    qualification_fingerprint, override_reason, created_by
  ) values (
    p_organization_id,
    v_visit.id,
    v_crew,
    coalesce(array(
      select distinct assignment.team_source_id
      from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = v_visit.id
        and assignment.team_source_id is not null
    ), '{}'::uuid[]),
    v_operation_assessment_id,
    v_assessed.capacity_fingerprint,
    v_assessed.qualification_fingerprint,
    nullif(btrim(v_assessed.override_reason), ''),
    p_actor_id
  );
end;
$function$;

revoke all on function app_private.record_job_visit_assessment(uuid, uuid, uuid, integer, uuid[], jsonb, boolean)
  from public, anon, authenticated;
grant execute on function app_private.record_job_visit_assessment(uuid, uuid, uuid, integer, uuid[], jsonb, boolean)
  to service_role;

-- Same signature, grants and behavior: the body moved into the variant above.
create or replace function app_private.record_job_visit_assessment(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_before_version integer,
  p_before_employee_record_ids uuid[],
  p_visit_assessment jsonb
)
returns void
language sql
set search_path = ''
as $function$
  select app_private.record_job_visit_assessment(
    p_organization_id, p_job_id, p_actor_id, p_before_version, p_before_employee_record_ids,
    p_visit_assessment, false
  );
$function$;

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
  -- The unpark puts the team on the revived visit also when it started today.
  perform app_private.record_job_visit_assessment(
    p_organization_id, p_job_id, p_actor_id, v_before_version,
    coalesce(v_before_crew, '{}'::uuid[]), p_visit_assessment, true
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
