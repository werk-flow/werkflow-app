
create or replace function public.reschedule_planning_series(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid,
  p_expected_version integer,
  p_scope text,
  p_series jsonb,
  p_occurrences jsonb,
  p_assignments jsonb,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text,
  p_override_reason text default null
)
returns uuid[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_selected public.planning_occurrences%rowtype;
  v_old_series public.planning_series%rowtype;
  v_target_series_id uuid;
  v_boundary text;
  v_item jsonb;
  v_identity text;
  v_occurrence_id uuid;
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
  v_assignment jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_job_id uuid;
  v_projection record;
begin
  if p_scope not in ('future', 'series') then
    raise exception 'invalid_planning_scope';
  end if;
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array'
     or jsonb_array_length(p_occurrences) = 0 then
    raise exception 'planning_occurrences_required';
  end if;

  select * into v_selected
  from public.planning_occurrences
  where id = p_occurrence_id and organization_id = p_organization_id
  for update;
  if not found or v_selected.series_id is null or v_selected.series_lineage_id is null then
    raise exception 'planning_series_not_found';
  end if;
  if v_selected.version <> p_expected_version then
    raise exception 'stale_planning_occurrence';
  end if;

  select * into v_old_series
  from public.planning_series
  where id = v_selected.series_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'planning_series_not_found'; end if;

  if p_scope = 'future' then
    v_boundary := v_selected.original_start_local;
  else
    select min(occurrence.original_start_local)
    into v_boundary
    from public.planning_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.series_lineage_id = v_selected.series_lineage_id
      and occurrence.original_start_local is not null
      and occurrence.status = 'scheduled'
      and not occurrence.is_exception
      and (
        (occurrence.start_at is not null and occurrence.start_at > now())
        or
        (occurrence.start_date is not null
         and occurrence.start_date > (now() at time zone 'Europe/Berlin')::date)
      );
    if v_boundary is null then raise exception 'no_mutable_series_occurrence'; end if;
  end if;

  if p_scope = 'future' and v_boundary > v_old_series.segment_start_local then
    update public.planning_series
    set segment_end_before_local = v_boundary,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_old_series.id;

    insert into public.planning_series (
      organization_id, lineage_id, previous_series_id, job_id, entry_kind,
      internal_type, title, description, location, time_kind, timezone,
      starts_at_local, duration_minutes, duration_days, recurrence_frequency,
      recurrence_interval, weekdays, month_day, occurrence_count,
      until_local_date, segment_start_local, generated_through_local,
      created_by, updated_by
    ) values (
      p_organization_id, v_selected.series_lineage_id, v_old_series.id,
      v_old_series.job_id, v_old_series.entry_kind, v_old_series.internal_type,
      v_old_series.title, v_old_series.description, v_old_series.location,
      (p_series->>'timeKind')::public.planning_time_kind, 'Europe/Berlin',
      p_series->>'startsAtLocal',
      nullif(p_series->>'durationMinutes', '')::integer,
      nullif(p_series->>'durationDays', '')::integer,
      p_series->>'frequency', (p_series->>'interval')::integer,
      case when p_series->'weekdays' is null or p_series->'weekdays' = 'null'::jsonb
        then null
        else array(select jsonb_array_elements_text(p_series->'weekdays')::smallint)
      end,
      nullif(p_series->>'monthDay', '')::smallint,
      nullif(p_series->>'occurrenceCount', '')::integer,
      nullif(p_series->>'untilLocalDate', '')::date,
      v_boundary, nullif(p_series->>'generatedThroughLocal', ''),
      p_actor_id, p_actor_id
    ) returning id into v_target_series_id;
  else
    select series.id into v_target_series_id
    from public.planning_series series
    where series.organization_id = p_organization_id
      and series.lineage_id = v_selected.series_lineage_id
      and series.segment_start_local <= v_boundary
      and (series.segment_end_before_local is null or v_boundary < series.segment_end_before_local)
    order by series.segment_start_local desc
    limit 1;
    v_target_series_id := coalesce(v_target_series_id, v_old_series.id);

    update public.planning_series
    set starts_at_local = p_series->>'startsAtLocal',
        duration_minutes = nullif(p_series->>'durationMinutes', '')::integer,
        duration_days = nullif(p_series->>'durationDays', '')::integer,
        recurrence_frequency = p_series->>'frequency',
        recurrence_interval = (p_series->>'interval')::integer,
        weekdays = case when p_series->'weekdays' is null or p_series->'weekdays' = 'null'::jsonb
          then null
          else array(select jsonb_array_elements_text(p_series->'weekdays')::smallint)
        end,
        month_day = nullif(p_series->>'monthDay', '')::smallint,
        occurrence_count = nullif(p_series->>'occurrenceCount', '')::integer,
        until_local_date = nullif(p_series->>'untilLocalDate', '')::date,
        generated_through_local = nullif(p_series->>'generatedThroughLocal', ''),
        segment_end_before_local = null,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_target_series_id;
  end if;

  update public.planning_occurrences occurrence
  set status = 'cancelled',
      version = occurrence.version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where occurrence.organization_id = p_organization_id
    and occurrence.series_lineage_id = v_selected.series_lineage_id
    and occurrence.original_start_local >= v_boundary
    and occurrence.status = 'scheduled'
    and not occurrence.is_exception
    and (
      (occurrence.start_at is not null and occurrence.start_at > now())
      or
      (occurrence.start_date is not null
       and occurrence.start_date > (now() at time zone 'Europe/Berlin')::date)
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_occurrences) item
      where item.value->>'identityOriginalStartLocal' = occurrence.original_start_local
    );

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    v_identity := v_item->>'identityOriginalStartLocal';
    select * into v_before
    from public.planning_occurrences
    where organization_id = p_organization_id
      and series_lineage_id = v_selected.series_lineage_id
      and original_start_local = v_identity
    for update;

    if found then
      if v_before.is_exception and v_before.id <> p_occurrence_id then
        v_ids := array_append(v_ids, v_before.id);
        continue;
      end if;
      if (v_before.start_at is not null and v_before.start_at <= now())
         or (v_before.start_date is not null
             and v_before.start_date <= (now() at time zone 'Europe/Berlin')::date) then
        v_ids := array_append(v_ids, v_before.id);
        continue;
      end if;

      update public.planning_occurrences
      set series_id = v_target_series_id,
          start_at = nullif(v_item->>'startAt', '')::timestamptz,
          end_at = nullif(v_item->>'endAt', '')::timestamptz,
          start_date = nullif(v_item->>'startDate', '')::date,
          end_date_exclusive = nullif(v_item->>'endDateExclusive', '')::date,
          status = 'scheduled',
          dst_resolution = coalesce(nullif(v_item->>'dstResolution', ''), 'exact'),
          is_exception = id = p_occurrence_id or is_exception,
          version = version + 1,
          updated_by = p_actor_id,
          updated_at = now()
      where id = v_before.id
      returning * into v_after;
      v_occurrence_id := v_after.id;
    else
      insert into public.planning_occurrences (
        organization_id, series_id, series_lineage_id, original_start_local,
        job_id, entry_kind, internal_type, title, description, location,
        time_kind, timezone, start_at, end_at, start_date, end_date_exclusive,
        status, is_exception, dst_resolution, created_by, updated_by
      ) values (
        p_organization_id, v_target_series_id, v_selected.series_lineage_id,
        v_identity, v_old_series.job_id, v_old_series.entry_kind,
        v_old_series.internal_type, v_old_series.title, v_old_series.description,
        v_old_series.location,
        (v_item->>'timeKind')::public.planning_time_kind, 'Europe/Berlin',
        nullif(v_item->>'startAt', '')::timestamptz,
        nullif(v_item->>'endAt', '')::timestamptz,
        nullif(v_item->>'startDate', '')::date,
        nullif(v_item->>'endDateExclusive', '')::date,
        'scheduled', false,
        coalesce(nullif(v_item->>'dstResolution', ''), 'exact'),
        p_actor_id, p_actor_id
      ) returning * into v_after;
      v_occurrence_id := v_after.id;
    end if;
    v_ids := array_append(v_ids, v_occurrence_id);

    delete from public.planning_occurrence_assignments
    where occurrence_id = v_occurrence_id;

    for v_assignment in
      select value
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
      where value->>'occurrenceOriginalStartLocal' = v_identity
         or nullif(value->>'occurrenceOriginalStartLocal', '') is null
    loop
      insert into public.planning_occurrence_assignments (
        organization_id, occurrence_id, employee_record_id, team_source_id, assigned_by
      ) values (
        p_organization_id, v_occurrence_id,
        (v_assignment->>'employeeRecordId')::uuid,
        nullif(v_assignment->>'teamSourceId', '')::uuid,
        p_actor_id
      ) on conflict (occurrence_id, employee_record_id) do nothing;
    end loop;

    insert into public.planning_occurrence_assessments (
      organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
      capacity_snapshot, capacity_fingerprint, qualification_snapshot,
      qualification_fingerprint, override_reason, created_by
    ) values (
      p_organization_id, v_occurrence_id,
      coalesce(array(
        select distinct (value->>'employeeRecordId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
        where value->>'occurrenceOriginalStartLocal' = v_identity
           or nullif(value->>'occurrenceOriginalStartLocal', '') is null
      ), '{}'::uuid[]),
      coalesce(array(
        select distinct (value->>'teamSourceId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
        where (value->>'occurrenceOriginalStartLocal' = v_identity
               or nullif(value->>'occurrenceOriginalStartLocal', '') is null)
          and nullif(value->>'teamSourceId', '') is not null
      ), '{}'::uuid[]),
      coalesce(p_capacity_snapshot, '{}'::jsonb), p_capacity_fingerprint,
      coalesce(p_qualification_snapshot, '{}'::jsonb), p_qualification_fingerprint,
      p_override_reason, p_actor_id
    );

    insert into public.planning_events (
      organization_id, series_id, occurrence_id, event_type, mutation_scope,
      before_state, after_state, reason, created_by
    ) values (
      p_organization_id, v_target_series_id, v_occurrence_id,
      case when v_before.id is null then 'generated' else 'updated' end,
      p_scope,
      case when v_before.id is null then null else to_jsonb(v_before) end,
      to_jsonb(v_after), p_override_reason, p_actor_id
    );
  end loop;

  insert into public.planning_events (
    organization_id, series_id, occurrence_id, event_type, mutation_scope,
    before_state, after_state, reason, created_by
  ) values (
    p_organization_id, v_target_series_id, p_occurrence_id,
    case when p_scope = 'future' then 'series_split' else 'series_updated' end,
    p_scope, to_jsonb(v_old_series), p_series, p_override_reason, p_actor_id
  );

  v_job_id := v_old_series.job_id;
  if v_job_id is not null then
    insert into public.job_assignments (job_id, user_id, assigned_by)
    select distinct v_job_id, employee.user_id, p_actor_id
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
      and occurrence.job_id = v_job_id
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
      where id = v_job_id and organization_id = p_organization_id;
    end if;
  end if;

  return v_ids;
end;
$$;

revoke all on function public.reschedule_planning_series(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb,
  jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.reschedule_planning_series(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb,
  jsonb, text, jsonb, text, text
) to service_role;
