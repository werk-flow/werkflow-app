-- A job-page team change that adds people records the capacity assessment of
-- the visit it reaches, in the same call that changes the team.
--
-- A person added to the job team reaches the job's legacy visit while that
-- visit has not started (app_private.sync_legacy_job_assignment,
-- 20261006100100). The job page saved that addition without the capacity
-- check every planning write runs, so people were planned onto vacation or
-- after their exit without a warning (werk-flow/werkflow-planning#69). The
-- server now assesses the visit as the calendar does and refuses a conflict
-- without a reason. This function stores what the manager confirmed: one
-- operation assessment and one occurrence assessment with the reason, beside
-- the unchanged team replacement and its qualification assessment. The
-- server decided from the team it read whether the change adds anyone to the
-- visit, so the function refuses the write when that team changed meanwhile.
--
-- Expand-only: a new function. replace_job_assignments_with_assessment keeps
-- its signature and body, so the previous release and the job write
-- functions that call it work unchanged. supabase/tests/job_plan_bridge.sql
-- holds the rules.

create function public.replace_job_assignments_with_visit_assessment(
  p_organization_id uuid,
  p_job_id uuid,
  p_selected_user_ids uuid[],
  p_actor_id uuid,
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean,
  p_expected_user_ids uuid[],
  p_visit_id uuid,
  p_visit_version integer,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text,
  p_planning_override_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_visit public.planning_occurrences%rowtype;
  v_operation_assessment_id uuid;
begin
  -- The team the server assessed against is still the job's team; the job row
  -- lock serializes this check with a concurrent change through this function.
  perform 1
  from public.jobs
  where id = p_job_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'job organization mismatch';
  end if;
  if coalesce((
    select array_agg(assignment.user_id order by assignment.user_id)
    from public.job_assignments assignment
    where assignment.job_id = p_job_id
  ), '{}'::uuid[]) <> coalesce((
    select array_agg(distinct expected order by expected)
    from unnest(p_expected_user_ids) as expected
  ), '{}'::uuid[]) then
    raise exception 'stale_job_assignments';
  end if;

  -- A change the server assessed without a visit must still reach none: an
  -- added person with a personnel record would join an unstarted legacy visit
  -- that was scheduled meanwhile, unassessed.
  if p_visit_id is null
     and exists (
       select 1
       from unnest(p_selected_user_ids) as selected_user_id
       join public.employee_records employee
         on employee.organization_id = p_organization_id and employee.user_id = selected_user_id
       where not (selected_user_id = any(coalesce(p_expected_user_ids, '{}'::uuid[])))
     )
     and exists (
       select 1
       from public.planning_occurrences occurrence
       where occurrence.organization_id = p_organization_id
         and occurrence.legacy_source_job_id = p_job_id
         and occurrence.status = 'scheduled'
         and coalesce(
           occurrence.start_at > now(),
           occurrence.start_date > (now() at time zone 'Europe/Berlin')::date,
           false
         )
     ) then
    raise exception 'stale_planning_occurrence';
  end if;

  -- The assessed visit must still be the job's unstarted legacy visit in the
  -- version the server assessed; otherwise the confirmation is stale.
  if p_visit_id is not null then
    select * into v_visit
    from public.planning_occurrences
    where id = p_visit_id
      and organization_id = p_organization_id
      and legacy_source_job_id = p_job_id
    for update;

    if not found then
      raise exception 'planning_occurrence_not_found';
    end if;
    if v_visit.version is distinct from p_visit_version
       or v_visit.status <> 'scheduled'
       or not coalesce(
         v_visit.start_at > now(),
         v_visit.start_date > (now() at time zone 'Europe/Berlin')::date,
         false
       ) then
      raise exception 'stale_planning_occurrence';
    end if;
  end if;

  perform public.replace_job_assignments_with_assessment(
    p_organization_id,
    p_job_id,
    p_selected_user_ids,
    p_actor_id,
    p_assessed_for_date,
    p_selected_employee_record_ids,
    p_requirements_snapshot,
    p_coverage_snapshot,
    p_coverage_fingerprint,
    p_override_reason,
    p_team_source_id,
    p_record_assessment
  );

  if p_visit_id is null then
    return;
  end if;

  v_operation_assessment_id := app_private.record_planning_operation_assessment(
    p_organization_id, p_actor_id, p_capacity_snapshot, p_qualification_snapshot
  );

  -- The people on the visit after the team change, as the assessment saw them.
  insert into public.planning_occurrence_assessments (
    organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
    operation_assessment_id, capacity_fingerprint,
    qualification_fingerprint, override_reason, created_by
  ) values (
    p_organization_id,
    p_visit_id,
    coalesce(array(
      select assignment.employee_record_id
      from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = p_visit_id
      order by assignment.employee_record_id
    ), '{}'::uuid[]),
    coalesce(array(
      select distinct assignment.team_source_id
      from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = p_visit_id
        and assignment.team_source_id is not null
    ), '{}'::uuid[]),
    v_operation_assessment_id,
    p_capacity_fingerprint,
    p_qualification_fingerprint,
    nullif(btrim(p_planning_override_reason), ''),
    p_actor_id
  );
end;
$function$;

revoke all on function public.replace_job_assignments_with_visit_assessment(
  uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean,
  uuid[], uuid, integer, jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.replace_job_assignments_with_visit_assessment(
  uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean,
  uuid[], uuid, integer, jsonb, text, jsonb, text, text
) to service_role;
