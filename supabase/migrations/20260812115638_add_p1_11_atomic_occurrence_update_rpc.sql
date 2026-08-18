
create or replace function public.update_planning_occurrence(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid,
  p_expected_version integer,
  p_occurrence jsonb,
  p_assignments jsonb,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text,
  p_override_reason text default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
  v_assignment jsonb;
  v_projection record;
begin
  select * into v_before
  from public.planning_occurrences
  where id = p_occurrence_id
    and organization_id = p_organization_id
  for update;

  if not found then raise exception 'planning_occurrence_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'stale_planning_occurrence'; end if;
  if (v_before.start_at is not null and v_before.start_at <= now())
     or (v_before.start_date is not null and v_before.start_date <= (now() at time zone 'Europe/Berlin')::date) then
    raise exception 'started_planning_occurrence_immutable';
  end if;

  update public.planning_occurrences
  set start_at = nullif(p_occurrence->>'startAt', '')::timestamptz,
      end_at = nullif(p_occurrence->>'endAt', '')::timestamptz,
      start_date = nullif(p_occurrence->>'startDate', '')::date,
      end_date_exclusive = nullif(p_occurrence->>'endDateExclusive', '')::date,
      dst_resolution = coalesce(nullif(p_occurrence->>'dstResolution', ''), dst_resolution),
      is_exception = is_exception or series_id is not null,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_occurrence_id
  returning * into v_after;

  delete from public.planning_occurrence_assignments
  where occurrence_id = p_occurrence_id;

  for v_assignment in select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    insert into public.planning_occurrence_assignments (
      organization_id, occurrence_id, employee_record_id, team_source_id, assigned_by
    ) values (
      p_organization_id, p_occurrence_id,
      (v_assignment->>'employeeRecordId')::uuid,
      nullif(v_assignment->>'teamSourceId', '')::uuid,
      p_actor_id
    );
  end loop;

  insert into public.planning_occurrence_assessments (
    organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
    capacity_snapshot, capacity_fingerprint, qualification_snapshot,
    qualification_fingerprint, override_reason, created_by
  ) values (
    p_organization_id, p_occurrence_id,
    coalesce(array(
      select distinct (value->>'employeeRecordId')::uuid
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
    ), '{}'::uuid[]),
    coalesce(array(
      select distinct (value->>'teamSourceId')::uuid
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
      where nullif(value->>'teamSourceId', '') is not null
    ), '{}'::uuid[]),
    coalesce(p_capacity_snapshot, '{}'::jsonb), p_capacity_fingerprint,
    coalesce(p_qualification_snapshot, '{}'::jsonb), p_qualification_fingerprint,
    p_override_reason, p_actor_id
  );

  insert into public.planning_events (
    organization_id, series_id, occurrence_id, event_type, mutation_scope,
    before_state, after_state, reason, created_by
  ) values (
    p_organization_id, v_before.series_id, p_occurrence_id, 'updated', 'one',
    to_jsonb(v_before), to_jsonb(v_after), p_override_reason, p_actor_id
  );

  if v_before.job_id is not null then
    insert into public.job_assignments (job_id, user_id, assigned_by)
    select distinct v_before.job_id, employee.user_id, p_actor_id
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
    join public.employee_records employee
      on employee.id = (assignment.value->>'employeeRecordId')::uuid
     and employee.organization_id = p_organization_id
    where employee.user_id is not null
    on conflict (job_id, user_id) do nothing;

    select occurrence.start_at, occurrence.start_date, occurrence.end_at
    into v_projection
    from public.planning_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.job_id = v_before.job_id
      and occurrence.status = 'scheduled'
    order by coalesce(occurrence.start_at, occurrence.start_date::timestamptz)
    limit 1;

    if found then
      perform set_config('app.planning_projection_write', 'true', true);
      update public.jobs
      set planned_date = coalesce(
            (v_projection.start_at at time zone 'Europe/Berlin')::date,
            v_projection.start_date
          ),
          planned_time = case when v_projection.start_at is null then null
            else (v_projection.start_at at time zone 'Europe/Berlin')::time end,
          estimated_duration_minutes = case
            when v_projection.start_at is null or v_projection.end_at is null
              then estimated_duration_minutes
            else greatest(1, extract(epoch from (v_projection.end_at - v_projection.start_at))::integer / 60)
          end,
          updated_at = now()
      where id = v_before.job_id and organization_id = p_organization_id;
    end if;
  end if;

  return v_after.version;
end;
$$;

revoke all on function public.update_planning_occurrence(
  uuid, uuid, uuid, integer, jsonb, jsonb, jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.update_planning_occurrence(
  uuid, uuid, uuid, integer, jsonb, jsonb, jsonb, text, jsonb, text, text
) to service_role;
