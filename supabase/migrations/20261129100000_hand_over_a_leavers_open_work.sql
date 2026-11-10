-- A leaver's open work goes to the people the office picks: job team and
-- visits together, in one call (werk-flow/werkflow-planning#156).
--
-- The offboarding only asked the admin to tick „Offene Zuordnungen wurden
-- geprüft“; every job assignment and visit of the leaver stayed, and the
-- office opened each job by hand. The office now picks a target person per
-- open job and a handover date. For each job, every visit of the leaver
-- that is scheduled, has not started and starts on or after that date goes
-- to the target, and the target joins the job's team. The leaver leaves the
-- team once no such visit before the handover date keeps them on the job
-- (docs/technical/data-model.md, "Job team and visit plan").
--
-- The server assesses the visits with the people they will have, as every
-- planning write does: capacity over the whole handover, qualifications per
-- job, and passes them per job. The function locks the visits, then the
-- jobs, recomputes which ones move and refuses the whole call
-- when they, their version or their people differ from the assessed ones
-- (stale_planning_occurrence). Each moved visit gets a 'reassigned' planning
-- event and an occurrence assessment with the reason; the leaver's
-- personnel history records the handover.
--
-- Expand-only: two new functions. supabase/tests/job_plan_bridge.sql holds
-- the rules of both.

create function public.hand_over_personnel_work(
  p_organization_id uuid,
  p_actor_id uuid,
  p_employee_record_id uuid,
  p_handover_from date,
  p_rows jsonb,
  p_assessments jsonb,
  p_override_reason text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_leaver public.employee_records%rowtype;
  v_target public.employee_records%rowtype;
  v_row record;
  v_visit record;
  v_assessment jsonb;
  v_assessed_visits jsonb;
  v_crew_before uuid[];
  v_crew_after uuid[];
  v_moved integer;
  v_operation_assessment_id uuid;
  v_handed_over jsonb := '[]'::jsonb;
begin
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;

  select * into v_leaver
  from public.employee_records record
  where record.id = p_employee_record_id and record.organization_id = p_organization_id;
  if v_leaver.id is null then
    raise exception 'employee_record_not_found';
  end if;

  if p_handover_from is null or p_handover_from < v_today then
    raise exception 'invalid_handover_date';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) = 0
     or jsonb_typeof(coalesce(p_assessments, '[]'::jsonb)) <> 'array'
     or (select count(distinct value->>'jobId') from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
  then
    raise exception 'invalid_handover';
  end if;

  -- The visits first, in id order, as the calendar locks a visit before its
  -- job; project_plan_onto_job locks each job afterwards.
  perform 1
  from public.planning_occurrences occurrence
  where occurrence.organization_id = p_organization_id
    and occurrence.job_id in (select (value->>'jobId')::uuid from jsonb_array_elements(p_rows))
    and exists (
      select 1 from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = occurrence.id
        and assignment.employee_record_id = p_employee_record_id
    )
  order by occurrence.id
  for update;
  -- Then the jobs, as a team edit locks them, so two handovers or a team edit
  -- of one job run in turn and each checks the leaver's hold under the lock.
  perform 1
  from public.jobs job
  where job.organization_id = p_organization_id
    and job.id in (select (value->>'jobId')::uuid from jsonb_array_elements(p_rows))
  order by job.id
  for no key update;

  -- Every assessment belongs to a job the call hands over.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_assessments, '[]'::jsonb)) assessment
    where not exists (
      select 1 from jsonb_array_elements(p_rows) handed
      where handed.value->>'jobId' = assessment.value->>'jobId'
    )
  ) then
    raise exception 'stale_planning_occurrence';
  end if;

  for v_row in
    select (value->>'jobId')::uuid as job_id, (value->>'targetEmployeeRecordId')::uuid as target_id
    from jsonb_array_elements(p_rows)
    order by value->>'jobId'
  loop
    if not exists (
      select 1 from public.jobs job
      where job.id = v_row.job_id
        and job.organization_id = p_organization_id
        and job.status in ('nicht_bearbeitet', 'in_bearbeitung', 'geparkt')
    ) then
      raise exception 'job_not_found';
    end if;

    select * into v_target
    from public.employee_records record
    where record.id = v_row.target_id and record.organization_id = p_organization_id;
    if v_target.id is null then
      raise exception 'target_not_found';
    end if;
    if v_target.id = v_leaver.id then
      raise exception 'invalid_target';
    end if;
    if v_target.exit_date is not null and v_target.exit_date < p_handover_from then
      raise exception 'target_not_available';
    end if;

    -- The leaver holds the job: on its team, or on one of its upcoming visits.
    if not exists (
      select 1 from public.job_assignments team
      where team.job_id = v_row.job_id and team.user_id = v_leaver.user_id
    ) and not exists (
      select 1
      from public.planning_occurrences occurrence
      join public.planning_occurrence_assignments assignment on assignment.occurrence_id = occurrence.id
      where occurrence.organization_id = p_organization_id
        and occurrence.job_id = v_row.job_id
        and occurrence.status = 'scheduled'
        and assignment.employee_record_id = v_leaver.id
        and coalesce(occurrence.start_at > now(), occurrence.start_date > v_today, false)
    ) then
      raise exception 'stale_handover';
    end if;

    select assessment.value into v_assessment
    from jsonb_array_elements(coalesce(p_assessments, '[]'::jsonb)) assessment
    where assessment.value->>'jobId' = v_row.job_id::text;
    v_assessed_visits := coalesce(v_assessment->'visits', '[]'::jsonb);
    v_moved := 0;

    for v_visit in
      select occurrence.*
      from public.planning_occurrences occurrence
      where occurrence.organization_id = p_organization_id
        and occurrence.job_id = v_row.job_id
        and occurrence.status = 'scheduled'
        and coalesce(occurrence.start_at > now(), occurrence.start_date > v_today, false)
        and coalesce((occurrence.start_at at time zone 'Europe/Berlin')::date, occurrence.start_date)
          >= p_handover_from
        and exists (
          select 1 from public.planning_occurrence_assignments assignment
          where assignment.occurrence_id = occurrence.id
            and assignment.employee_record_id = v_leaver.id
        )
      order by occurrence.id
    loop
      v_crew_before := array(
        select assignment.employee_record_id
        from public.planning_occurrence_assignments assignment
        where assignment.occurrence_id = v_visit.id
        order by assignment.employee_record_id
      );
      v_crew_after := array(
        select distinct crew_member
        from unnest(array_remove(v_crew_before, v_leaver.id) || v_target.id) as crew_member
        order by crew_member
      );
      -- The visit, its version and its people as the server assessed them.
      if not exists (
        select 1 from jsonb_array_elements(v_assessed_visits) assessed
        where assessed.value->>'occurrenceId' = v_visit.id::text
          and (assessed.value->>'version')::integer = v_visit.version
          and array(
            select distinct value::uuid
            from jsonb_array_elements_text(assessed.value->'employeeRecordIds')
            order by value::uuid
          ) = v_crew_after
      ) then
        raise exception 'stale_planning_occurrence';
      end if;

      -- One operation assessment per job, as the server assessed each job on its own.
      if v_moved = 0 then
        v_operation_assessment_id := app_private.record_planning_operation_assessment(
          p_organization_id, p_actor_id, v_assessment->'capacitySnapshot', v_assessment->'qualificationSnapshot'
        );
      end if;

      delete from public.planning_occurrence_assignments assignment
      where assignment.occurrence_id = v_visit.id and assignment.employee_record_id = v_leaver.id;
      insert into public.planning_occurrence_assignments (
        organization_id, occurrence_id, employee_record_id, assigned_by
      ) values (p_organization_id, v_visit.id, v_target.id, p_actor_id)
      on conflict (occurrence_id, employee_record_id) do nothing;
      update public.planning_occurrences occurrence
      set version = occurrence.version + 1, updated_by = p_actor_id, updated_at = now()
      where occurrence.id = v_visit.id;

      insert into public.planning_events (
        organization_id, series_id, occurrence_id, event_type, mutation_scope,
        before_state, after_state, reason, created_by
      ) values (
        p_organization_id, v_visit.series_id, v_visit.id, 'reassigned', 'one',
        jsonb_build_object('employeeRecordIds', to_jsonb(v_crew_before)),
        jsonb_build_object('employeeRecordIds', to_jsonb(v_crew_after)),
        nullif(btrim(p_override_reason), ''), p_actor_id
      );
      insert into public.planning_occurrence_assessments (
        organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
        operation_assessment_id, capacity_fingerprint, qualification_fingerprint,
        override_reason, created_by
      ) values (
        p_organization_id, v_visit.id, v_crew_after,
        coalesce(array(
          select distinct assignment.team_source_id
          from public.planning_occurrence_assignments assignment
          where assignment.occurrence_id = v_visit.id and assignment.team_source_id is not null
        ), '{}'::uuid[]),
        v_operation_assessment_id,
        v_assessment->>'capacityFingerprint',
        v_assessment->>'qualificationFingerprint',
        nullif(btrim(p_override_reason), ''),
        p_actor_id
      );
      v_moved := v_moved + 1;
    end loop;

    if v_moved <> jsonb_array_length(v_assessed_visits)
       or (v_moved > 0 and (
         v_assessment->>'capacityFingerprint' is null or v_assessment->>'qualificationFingerprint' is null
       )) then
      raise exception 'stale_planning_occurrence';
    end if;
    -- Work without a visit stays on the team, which only a person with a login joins.
    if v_target.user_id is null and v_moved = 0 then
      raise exception 'target_without_login';
    end if;

    -- The target joins the team without the team trigger, so no visit the
    -- server did not assess gains them.
    perform app_private.project_plan_onto_job(p_organization_id, v_row.job_id, p_actor_id, array[v_target.id]);

    -- The leaver leaves the team once no upcoming visit keeps them on the job.
    if v_leaver.user_id is not null and not exists (
      select 1
      from public.planning_occurrences occurrence
      join public.planning_occurrence_assignments assignment on assignment.occurrence_id = occurrence.id
      where occurrence.organization_id = p_organization_id
        and occurrence.job_id = v_row.job_id
        and occurrence.status = 'scheduled'
        and assignment.employee_record_id = v_leaver.id
        and coalesce(occurrence.start_at > now(), occurrence.start_date > v_today, false)
    ) then
      delete from public.job_assignments team
      where team.job_id = v_row.job_id and team.user_id = v_leaver.user_id;
    end if;

    v_handed_over := v_handed_over || jsonb_build_object(
      'jobId', v_row.job_id, 'targetEmployeeRecordId', v_target.id, 'visits', v_moved
    );
  end loop;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_leaver.id, 'work_handed_over',
    jsonb_build_object('handoverFrom', p_handover_from, 'jobs', v_handed_over), p_actor_id
  );

  return jsonb_array_length(v_handed_over);
end;
$function$;

revoke all on function public.hand_over_personnel_work(uuid, uuid, uuid, date, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.hand_over_personnel_work(uuid, uuid, uuid, date, jsonb, jsonb, text)
  to service_role;

-- The open absences the attention tasks read in one request: the vacation
-- requests the approvers decide or the planners replan (pending, or approved
-- and ending on p_today or later, by start date, as the reader read them from
-- the table before), and each person whose exit date lies before an unstarted
-- visit they still hold, with the window from the day after the exit. Only
-- people with such a visit come back, so the result grows with the open
-- work, never with the people who left. The server resolves the organization
-- before it calls the function; the leftover visits become „Einsatz umplanen“.
create function public.read_open_absences(p_organization_id uuid, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'vacations', coalesce((
      select jsonb_agg(to_jsonb(request) order by request.start_date, request.id)
      from public.vacation_requests request
      where request.organization_id = p_organization_id
        and (request.status = 'pending' or (request.status = 'approved' and request.end_date >= p_today))
    ), '[]'::jsonb),
    'leaverWindows', coalesce((
      select jsonb_agg(
        jsonb_build_object('employeeRecordId', record.id, 'from', greatest(record.exit_date + 1, p_today))
        order by record.id
      )
      from public.employee_records record
      where record.organization_id = p_organization_id
        and record.exit_date is not null
        and exists (
          select 1
          from public.planning_occurrence_assignments assignment
          join public.planning_occurrences occurrence on occurrence.id = assignment.occurrence_id
          where assignment.employee_record_id = record.id
            and occurrence.organization_id = p_organization_id
            and occurrence.status = 'scheduled'
            and coalesce(occurrence.start_at > now(), occurrence.start_date > p_today, false)
            and coalesce((occurrence.start_at at time zone 'Europe/Berlin')::date, occurrence.start_date)
              > record.exit_date
        )
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.read_open_absences(uuid, date) from public, anon, authenticated;
grant execute on function public.read_open_absences(uuid, date) to service_role;
