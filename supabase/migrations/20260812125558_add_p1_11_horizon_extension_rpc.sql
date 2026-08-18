
create or replace function public.extend_planning_series_materialization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_series_id uuid,
  p_expected_generated_through_local timestamp without time zone,
  p_occurrences jsonb,
  p_assignments jsonb,
  p_capacity_snapshot jsonb default '{}'::jsonb,
  p_capacity_fingerprint text default '',
  p_qualification_snapshot jsonb default '{}'::jsonb,
  p_qualification_fingerprint text default '',
  p_override_reason text default null
)
returns uuid[]
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_series public.planning_series%rowtype;
  v_item jsonb;
  v_identity timestamp without time zone;
  v_occurrence_id uuid;
  v_assignment jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_inserted_count integer;
  v_latest_identity timestamp without time zone;
begin
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'planning_occurrences_array_required';
  end if;

  select *
  into v_series
  from public.planning_series
  where id = p_series_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'planning_series_not_found';
  end if;

  if v_series.generated_through_local is distinct from p_expected_generated_through_local then
    raise exception 'stale_planning_series';
  end if;

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    v_identity := (v_item->>'originalStartLocal')::timestamp;

    if v_identity < v_series.segment_start_local
       or (v_series.segment_end_before_local is not null
           and v_identity >= v_series.segment_end_before_local) then
      raise exception 'planning_occurrence_outside_series_segment';
    end if;

    insert into public.planning_occurrences (
      organization_id, series_id, series_lineage_id, original_start_local,
      job_id, entry_kind, internal_type, title, description, location,
      time_kind, timezone, start_at, end_at, start_date, end_date_exclusive,
      status, is_exception, dst_resolution, created_by, updated_by
    ) values (
      p_organization_id, v_series.id, v_series.lineage_id, v_identity,
      v_series.job_id, v_series.entry_kind, v_series.internal_type,
      v_series.title, v_series.description, v_series.location,
      (v_item->>'timeKind')::public.planning_time_kind, 'Europe/Berlin',
      nullif(v_item->>'startAt', '')::timestamptz,
      nullif(v_item->>'endAt', '')::timestamptz,
      nullif(v_item->>'startDate', '')::date,
      nullif(v_item->>'endDateExclusive', '')::date,
      'scheduled', false,
      coalesce(nullif(v_item->>'dstResolution', ''), 'exact'),
      p_actor_id, p_actor_id
    )
    on conflict (organization_id, series_lineage_id, original_start_local)
    do nothing
    returning id into v_occurrence_id;

    get diagnostics v_inserted_count = row_count;

    if v_inserted_count = 0 then
      select id
      into v_occurrence_id
      from public.planning_occurrences
      where organization_id = p_organization_id
        and series_lineage_id = v_series.lineage_id
        and original_start_local = v_identity;
    else
      for v_assignment in
        select value
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
        where value->>'occurrenceOriginalStartLocal' = v_item->>'originalStartLocal'
      loop
        insert into public.planning_occurrence_assignments (
          organization_id, occurrence_id, employee_record_id,
          team_source_id, assigned_by
        ) values (
          p_organization_id, v_occurrence_id,
          (v_assignment->>'employeeRecordId')::uuid,
          nullif(v_assignment->>'teamSourceId', '')::uuid,
          p_actor_id
        )
        on conflict (occurrence_id, employee_record_id) do nothing;
      end loop;

      insert into public.planning_occurrence_assessments (
        organization_id, occurrence_id, selected_employee_record_ids,
        team_source_ids, capacity_snapshot, capacity_fingerprint,
        qualification_snapshot, qualification_fingerprint,
        override_reason, created_by
      ) values (
        p_organization_id, v_occurrence_id,
        coalesce(array(
          select distinct (value->>'employeeRecordId')::uuid
          from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
          where value->>'occurrenceOriginalStartLocal' = v_item->>'originalStartLocal'
        ), '{}'::uuid[]),
        coalesce(array(
          select distinct (value->>'teamSourceId')::uuid
          from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
          where value->>'occurrenceOriginalStartLocal' = v_item->>'originalStartLocal'
            and nullif(value->>'teamSourceId', '') is not null
        ), '{}'::uuid[]),
        coalesce(p_capacity_snapshot, '{}'::jsonb), p_capacity_fingerprint,
        coalesce(p_qualification_snapshot, '{}'::jsonb),
        p_qualification_fingerprint, p_override_reason, p_actor_id
      );

      insert into public.planning_events (
        organization_id, series_id, occurrence_id, event_type,
        mutation_scope, after_state, reason, created_by
      ) values (
        p_organization_id, v_series.id, v_occurrence_id, 'materialized',
        'whole_series', v_item, p_override_reason, p_actor_id
      );
    end if;

    v_ids := array_append(v_ids, v_occurrence_id);
    v_latest_identity := greatest(
      coalesce(v_latest_identity, v_identity),
      v_identity
    );
  end loop;

  if v_latest_identity is not null then
    update public.planning_series
    set generated_through_local = greatest(
          coalesce(generated_through_local, v_latest_identity),
          v_latest_identity
        ),
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_series.id;
  end if;

  if v_series.job_id is not null then
    insert into public.job_assignments (job_id, user_id, assigned_by)
    select distinct v_series.job_id, employee.user_id, p_actor_id
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
    join public.employee_records employee
      on employee.id = (assignment.value->>'employeeRecordId')::uuid
     and employee.organization_id = p_organization_id
    where employee.user_id is not null
    on conflict (job_id, user_id) do nothing;
  end if;

  return v_ids;
end;
$function$;

revoke all on function public.extend_planning_series_materialization(
  uuid, uuid, uuid, timestamp without time zone, jsonb, jsonb,
  jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.extend_planning_series_materialization(
  uuid, uuid, uuid, timestamp without time zone, jsonb, jsonb,
  jsonb, text, jsonb, text, text
) to service_role;
