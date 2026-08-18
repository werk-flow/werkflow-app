
alter table public.planning_series
  add column creation_request_id uuid;

alter table public.planning_occurrences
  add column creation_request_id uuid;

create unique index planning_series_creation_request_unique
  on public.planning_series (organization_id, creation_request_id)
  where creation_request_id is not null;

create unique index planning_occurrences_creation_request_unique
  on public.planning_occurrences (organization_id, creation_request_id)
  where creation_request_id is not null and series_id is null;

drop function public.create_planning_entry_materialized(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text
);

create function public.create_planning_entry_materialized(
  p_organization_id uuid,
  p_actor_id uuid,
  p_series jsonb,
  p_occurrences jsonb,
  p_assignments jsonb,
  p_idempotency_key uuid,
  p_capacity_snapshot jsonb default '{}'::jsonb,
  p_capacity_fingerprint text default ''::text,
  p_qualification_snapshot jsonb default '{}'::jsonb,
  p_qualification_fingerprint text default ''::text,
  p_override_reason text default null
)
returns uuid[]
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_series_id uuid;
  v_lineage_id uuid;
  v_occurrence jsonb;
  v_original_start_local text;
  v_occurrence_id uuid;
  v_occurrence_ids uuid[] := '{}'::uuid[];
  v_assignment jsonb;
  v_job_id uuid;
  v_projection record;
begin
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array'
     or jsonb_array_length(p_occurrences) = 0 then
    raise exception 'planning_occurrences_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_idempotency_key::text, 0)
  );

  if p_series is not null then
    select id into v_series_id
    from public.planning_series
    where organization_id = p_organization_id
      and creation_request_id = p_idempotency_key;

    if found then
      select coalesce(array_agg(id order by original_start_local), '{}'::uuid[])
      into v_occurrence_ids
      from public.planning_occurrences
      where organization_id = p_organization_id
        and series_id = v_series_id;
      return v_occurrence_ids;
    end if;
  else
    select id into v_occurrence_id
    from public.planning_occurrences
    where organization_id = p_organization_id
      and creation_request_id = p_idempotency_key
      and series_id is null;

    if found then
      return array[v_occurrence_id];
    end if;
  end if;

  if p_series is not null then
    v_lineage_id := coalesce((p_series->>'lineageId')::uuid, gen_random_uuid());
    insert into public.planning_series (
      organization_id, lineage_id, previous_series_id, job_id, entry_kind,
      internal_type, title, description, location, time_kind, timezone,
      starts_at_local, duration_minutes, duration_days, recurrence_frequency,
      recurrence_interval, weekdays, month_day, occurrence_count,
      until_local_date, segment_start_local, segment_end_before_local,
      generated_through_local, creation_request_id, created_by, updated_by
    ) values (
      p_organization_id, v_lineage_id, nullif(p_series->>'previousSeriesId', '')::uuid,
      nullif(p_series->>'jobId', '')::uuid,
      (p_series->>'entryKind')::public.planning_entry_kind,
      nullif(p_series->>'internalType', '')::public.planning_internal_type,
      nullif(p_series->>'title', ''), nullif(p_series->>'description', ''),
      nullif(p_series->>'location', ''),
      (p_series->>'timeKind')::public.planning_time_kind,
      'Europe/Berlin', (p_series->>'startsAtLocal')::timestamp,
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
      (p_series->>'segmentStartLocal')::timestamp,
      nullif(p_series->>'segmentEndBeforeLocal', '')::timestamp,
      nullif(p_series->>'generatedThroughLocal', '')::timestamp,
      p_idempotency_key, p_actor_id, p_actor_id
    ) returning id into v_series_id;
  else
    v_lineage_id := null;
  end if;

  for v_occurrence in select value from jsonb_array_elements(p_occurrences)
  loop
    v_job_id := nullif(v_occurrence->>'jobId', '')::uuid;
    v_original_start_local := nullif(v_occurrence->>'originalStartLocal', '');
    insert into public.planning_occurrences (
      organization_id, series_id, series_lineage_id, original_start_local,
      job_id, entry_kind, internal_type, title, description, location,
      time_kind, timezone, start_at, end_at, start_date, end_date_exclusive,
      status, is_exception, dst_resolution, creation_request_id, created_by, updated_by
    ) values (
      p_organization_id, v_series_id, v_lineage_id,
      case when v_series_id is null then null else v_original_start_local::timestamp end,
      v_job_id, (v_occurrence->>'entryKind')::public.planning_entry_kind,
      nullif(v_occurrence->>'internalType', '')::public.planning_internal_type,
      nullif(v_occurrence->>'title', ''), nullif(v_occurrence->>'description', ''),
      nullif(v_occurrence->>'location', ''),
      (v_occurrence->>'timeKind')::public.planning_time_kind, 'Europe/Berlin',
      nullif(v_occurrence->>'startAt', '')::timestamptz,
      nullif(v_occurrence->>'endAt', '')::timestamptz,
      nullif(v_occurrence->>'startDate', '')::date,
      nullif(v_occurrence->>'endDateExclusive', '')::date,
      'scheduled', false, coalesce(nullif(v_occurrence->>'dstResolution', ''), 'exact'),
      case when v_series_id is null then p_idempotency_key else null end,
      p_actor_id, p_actor_id
    ) returning id into v_occurrence_id;
    v_occurrence_ids := array_append(v_occurrence_ids, v_occurrence_id);

    for v_assignment in
      select value
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
      where value->>'occurrenceOriginalStartLocal' = v_original_start_local
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
        where value->>'occurrenceOriginalStartLocal' = v_original_start_local
      ), '{}'::uuid[]),
      coalesce(array(
        select distinct (value->>'teamSourceId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
        where value->>'occurrenceOriginalStartLocal' = v_original_start_local
          and nullif(value->>'teamSourceId', '') is not null
      ), '{}'::uuid[]),
      coalesce(p_capacity_snapshot, '{}'::jsonb), p_capacity_fingerprint,
      coalesce(p_qualification_snapshot, '{}'::jsonb), p_qualification_fingerprint,
      p_override_reason, p_actor_id
    );

    insert into public.planning_events (
      organization_id, series_id, occurrence_id, event_type, mutation_scope,
      after_state, reason, created_by
    ) values (
      p_organization_id, v_series_id, v_occurrence_id, 'created',
      case when v_series_id is null then 'one' else 'whole_series' end,
      v_occurrence, p_override_reason, p_actor_id
    );
  end loop;

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

  return v_occurrence_ids;
end;
$function$;

revoke all on function public.create_planning_entry_materialized(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_planning_entry_materialized(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, jsonb, text, jsonb, text, text
) to service_role;
