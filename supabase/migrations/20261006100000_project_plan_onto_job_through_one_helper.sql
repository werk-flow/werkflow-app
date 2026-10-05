-- One owner writes a job from its visit plan.
--
-- Six planning functions and one trigger each carried their own copy of
-- "add the visit's people to the job and copy the first scheduled visit into
-- the job's schedule columns". Every copy set the transaction-local marker
-- app.planning_projection_write and none cleared it, so after the first
-- projection the job-to-plan trigger stayed muted for the rest of the
-- transaction: a later job edit in the same transaction no longer reached its
-- visit. The plan writes also added people to the job without the marker, so
-- the team trigger echoed each new person onto the job's legacy visit, a
-- visit the planner had not touched.
--
-- app_private.project_plan_onto_job is now the only writer of that
-- projection and the only function that sets the marker. It sets the marker,
-- writes, and restores the value it found. The marker means "a plan-to-job
-- write is in progress"; both job-to-plan triggers stay quiet while it is
-- set (the team trigger learns that in 20261006100100). Signatures, grants,
-- security modes and refusal codes of the callers stay as they were.
-- supabase/tests/job_plan_bridge.sql holds the rules.

create function app_private.project_plan_onto_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_employee_record_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_previous_marker text := current_setting('app.planning_projection_write', true);
  v_first record;
  v_planned_date date;
  v_planned_time time;
begin
  perform set_config('app.planning_projection_write', 'true', true);

  -- Every person with a login on a visit of the job is on the job's team.
  insert into public.job_assignments (job_id, user_id, assigned_by)
  select distinct p_job_id, employee.user_id, p_actor_id
  from public.employee_records employee
  where employee.id = any (coalesce(p_employee_record_ids, '{}'::uuid[]))
    and employee.organization_id = p_organization_id
    and employee.user_id is not null
  on conflict (job_id, user_id) do nothing;

  -- The job's schedule is its first scheduled visit, or empty without one.
  select occurrence.start_at, occurrence.start_date, occurrence.end_at
  into v_first
  from public.planning_occurrences occurrence
  where occurrence.organization_id = p_organization_id
    and occurrence.job_id = p_job_id
    and occurrence.status = 'scheduled'
  order by coalesce(occurrence.start_at, occurrence.start_date::timestamptz)
  limit 1;

  if found then
    v_planned_date := coalesce((v_first.start_at at time zone 'Europe/Berlin')::date, v_first.start_date);
    v_planned_time := (v_first.start_at at time zone 'Europe/Berlin')::time;
  end if;

  update public.jobs job
  set planned_date = v_planned_date,
      planned_time = v_planned_time,
      estimated_duration_minutes = case
        when v_first.start_at is null or v_first.end_at is null then job.estimated_duration_minutes
        else greatest(1, extract(epoch from (v_first.end_at - v_first.start_at))::integer / 60)
      end,
      updated_at = now()
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and (
      job.planned_date is distinct from v_planned_date
      or job.planned_time is distinct from v_planned_time
      or (
        v_first.start_at is not null and v_first.end_at is not null
        and job.estimated_duration_minutes is distinct from
          greatest(1, extract(epoch from (v_first.end_at - v_first.start_at))::integer / 60)
      )
    );

  perform set_config('app.planning_projection_write', coalesce(v_previous_marker, ''), true);
end;
$$;

-- The planning functions call it as the service role; nobody else does.
revoke all on function app_private.project_plan_onto_job(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function app_private.project_plan_onto_job(uuid, uuid, uuid, uuid[])
  to service_role;

create or replace function app_private.sync_job_status_from_planning_occurrences()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job_id uuid := coalesce(new.job_id, old.job_id);
  v_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  if v_job_id is null then return coalesce(new, old); end if;
  if not exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.organization_id = v_organization_id
      and occurrence.job_id = v_job_id
      and occurrence.status = 'scheduled'
  ) then
    perform app_private.project_plan_onto_job(v_organization_id, v_job_id, null, '{}'::uuid[]);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.create_planning_entry_materialized(
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
  p_override_reason text default null::text
)
returns uuid[]
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_series_id uuid;
  v_lineage_id uuid;
  v_occurrence jsonb;
  v_original_start_local text;
  v_occurrence_id uuid;
  v_occurrence_ids uuid[] := '{}'::uuid[];
  v_assignment jsonb;
  v_job_id uuid;
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
    perform app_private.project_plan_onto_job(
      p_organization_id, v_job_id, p_actor_id,
      array(
        select (assignment.value->>'employeeRecordId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
      )
    );
  end if;

  return v_occurrence_ids;
end;
$$;

create or replace function public.extend_planning_series_materialization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_series_id uuid,
  p_expected_generated_through_local timestamp without time zone,
  p_occurrences jsonb,
  p_assignments jsonb,
  p_capacity_snapshot jsonb default '{}'::jsonb,
  p_capacity_fingerprint text default ''::text,
  p_qualification_snapshot jsonb default '{}'::jsonb,
  p_qualification_fingerprint text default ''::text,
  p_override_reason text default null::text
)
returns uuid[]
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
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
    perform app_private.project_plan_onto_job(
      p_organization_id, v_series.job_id, p_actor_id,
      array(
        select (assignment.value->>'employeeRecordId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
      )
    );
  end if;

  return v_ids;
end;
$$;

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
  p_override_reason text default null::text
)
returns uuid[]
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_selected public.planning_occurrences%rowtype;
  v_old_series public.planning_series%rowtype;
  v_target_series_id uuid;
  v_boundary timestamp without time zone;
  v_item jsonb;
  v_identity timestamp without time zone;
  v_occurrence_id uuid;
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
  v_assignment jsonb;
  v_ids uuid[] := '{}'::uuid[];
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
      (p_series->>'startsAtLocal')::timestamp,
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
      v_boundary, nullif(p_series->>'generatedThroughLocal', '')::timestamp,
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
    set starts_at_local = (p_series->>'startsAtLocal')::timestamp,
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
        generated_through_local = nullif(p_series->>'generatedThroughLocal', '')::timestamp,
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
      where (item.value->>'identityOriginalStartLocal')::timestamp = occurrence.original_start_local
    );

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    v_identity := (v_item->>'identityOriginalStartLocal')::timestamp;
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
          is_exception = v_before.is_exception,
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
      where (value->>'occurrenceOriginalStartLocal')::timestamp = v_identity
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
        where (value->>'occurrenceOriginalStartLocal')::timestamp = v_identity
           or nullif(value->>'occurrenceOriginalStartLocal', '') is null
      ), '{}'::uuid[]),
      coalesce(array(
        select distinct (value->>'teamSourceId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
        where ((value->>'occurrenceOriginalStartLocal')::timestamp = v_identity
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
      case when v_before.id is null then 'created' else 'edited' end,
      case when p_scope = 'future' then 'this_and_future' else 'whole_series' end,
      case when v_before.id is null then null else to_jsonb(v_before) end,
      to_jsonb(v_after), p_override_reason, p_actor_id
    );
  end loop;

  insert into public.planning_events (
    organization_id, series_id, occurrence_id, event_type, mutation_scope,
    before_state, after_state, reason, created_by
  ) values (
    p_organization_id, v_target_series_id, p_occurrence_id,
    case when p_scope = 'future' then 'series_split' else 'series_changed' end,
    case when p_scope = 'future' then 'this_and_future' else 'whole_series' end, to_jsonb(v_old_series), p_series, p_override_reason, p_actor_id
  );

  if v_old_series.job_id is not null then
    perform app_private.project_plan_onto_job(
      p_organization_id, v_old_series.job_id, p_actor_id,
      array(
        select (assignment.value->>'employeeRecordId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
      )
    );
  end if;

  return v_ids;
end;
$$;

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
  p_override_reason text default null::text
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
  v_assignment jsonb;
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
    p_organization_id, v_before.series_id, p_occurrence_id, 'edited', 'one',
    to_jsonb(v_before), to_jsonb(v_after), p_override_reason, p_actor_id
  );

  if v_before.job_id is not null then
    perform app_private.project_plan_onto_job(
      p_organization_id, v_before.job_id, p_actor_id,
      array(
        select (assignment.value->>'employeeRecordId')::uuid
        from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) assignment
      )
    );
  end if;

  return v_after.version;
end;
$$;

create or replace function public.batch_reschedule_planning_occurrences(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text,
  p_items jsonb,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text,
  p_override_reason text default null::text
)
returns uuid[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_existing record;
  v_item jsonb;
  v_occurrence record;
  v_occurrence_id uuid;
  v_expected_version integer;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_start_date date;
  v_end_date_exclusive date;
  v_dst text;
  v_ids uuid[] := '{}'::uuid[];
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_selected uuid[];
  v_teams uuid[];
  v_count integer;
  v_job_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) not between 8 and 1000 then
    raise exception 'batch_reason_invalid';
  end if;
  v_count := coalesce(jsonb_array_length(p_items), 0);
  if v_count < 1 or v_count > 100 then
    raise exception 'batch_selection_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organization_id::text || ':batch-reschedule:' || p_request_id::text)
  );
  select e.* into v_existing
  from public.planning_events e
  where e.organization_id = p_organization_id
    and e.event_type = 'batch_rescheduled'
    and e.after_state ->> 'requestId' = p_request_id::text
  limit 1;
  if found then
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_ids
    from jsonb_array_elements_text(v_existing.after_state -> 'occurrenceIds');
    return v_ids;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_occurrence_id := (v_item ->> 'occurrenceId')::uuid;
    v_expected_version := (v_item ->> 'expectedVersion')::integer;
    v_start_at := (v_item ->> 'startAt')::timestamptz;
    v_end_at := (v_item ->> 'endAt')::timestamptz;
    v_start_date := (v_item ->> 'startDate')::date;
    v_end_date_exclusive := (v_item ->> 'endDateExclusive')::date;
    v_dst := coalesce(v_item ->> 'dstResolution', 'exact');

    select * into v_occurrence
    from public.planning_occurrences
    where id = v_occurrence_id and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'batch_item_not_found:%', v_occurrence_id;
    end if;
    if v_occurrence.status <> 'scheduled' then
      raise exception 'batch_item_not_scheduled:%', v_occurrence_id;
    end if;
    if v_occurrence.version <> v_expected_version then
      raise exception 'batch_item_stale:%', v_occurrence_id;
    end if;
    if v_occurrence.time_kind = 'timed' then
      if v_occurrence.start_at is null or v_occurrence.start_at <= now() then
        raise exception 'batch_item_started:%', v_occurrence_id;
      end if;
      if v_start_at is null or v_end_at is null or v_end_at <= v_start_at
        or v_start_date is not null or v_end_date_exclusive is not null then
        raise exception 'batch_item_invalid:%', v_occurrence_id;
      end if;
    else
      if v_occurrence.start_date is null or v_occurrence.start_date <= v_today then
        raise exception 'batch_item_started:%', v_occurrence_id;
      end if;
      if v_start_date is null or v_end_date_exclusive is null
        or v_end_date_exclusive <= v_start_date
        or v_start_at is not null or v_end_at is not null then
        raise exception 'batch_item_invalid:%', v_occurrence_id;
      end if;
    end if;

    update public.planning_occurrences
    set start_at = v_start_at,
        end_at = v_end_at,
        start_date = v_start_date,
        end_date_exclusive = v_end_date_exclusive,
        dst_resolution = v_dst,
        is_exception = (series_id is not null) or is_exception,
        version = version + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_occurrence_id;

    select
      coalesce(array_agg(a.employee_record_id), '{}'::uuid[]),
      coalesce(array_agg(a.team_source_id) filter (where a.team_source_id is not null), '{}'::uuid[])
    into v_selected, v_teams
    from public.planning_occurrence_assignments a
    where a.occurrence_id = v_occurrence_id;

    insert into public.planning_occurrence_assessments (
      organization_id, occurrence_id, selected_employee_record_ids, team_source_ids,
      capacity_snapshot, qualification_snapshot,
      capacity_fingerprint, qualification_fingerprint,
      override_reason, created_by
    ) values (
      p_organization_id, v_occurrence_id, v_selected, v_teams,
      coalesce(p_capacity_snapshot, '{}'::jsonb),
      coalesce(p_qualification_snapshot, '{}'::jsonb),
      p_capacity_fingerprint, p_qualification_fingerprint,
      nullif(btrim(coalesce(p_override_reason, '')), ''), p_actor_id
    );

    insert into public.planning_events (
      organization_id, series_id, occurrence_id, event_type, mutation_scope,
      before_state, after_state, reason, created_by
    ) values (
      p_organization_id, v_occurrence.series_id, v_occurrence_id, 'edited', 'one',
      jsonb_build_object(
        'startAt', v_occurrence.start_at, 'endAt', v_occurrence.end_at,
        'startDate', v_occurrence.start_date,
        'endDateExclusive', v_occurrence.end_date_exclusive,
        'version', v_occurrence.version
      ),
      jsonb_build_object(
        'startAt', v_start_at, 'endAt', v_end_at,
        'startDate', v_start_date, 'endDateExclusive', v_end_date_exclusive,
        'batchRequestId', p_request_id
      ),
      btrim(p_reason), p_actor_id
    );

    v_ids := v_ids || v_occurrence_id;
  end loop;

  for v_job_id in
    select distinct o.job_id
    from public.planning_occurrences o
    where o.id = any (v_ids) and o.job_id is not null
  loop
    perform app_private.project_plan_onto_job(p_organization_id, v_job_id, p_actor_id, '{}'::uuid[]);
  end loop;

  insert into public.planning_events (
    organization_id, occurrence_id, event_type, mutation_scope,
    after_state, reason, created_by
  ) values (
    p_organization_id, v_ids[1], 'batch_rescheduled', 'system',
    jsonb_build_object(
      'requestId', p_request_id,
      'occurrenceIds', to_jsonb(v_ids),
      'itemCount', array_length(v_ids, 1)
    ),
    btrim(p_reason), p_actor_id
  );

  return v_ids;
end;
$$;

create or replace function public.set_planning_occurrence_status(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid,
  p_expected_version integer,
  p_status public.planning_occurrence_status,
  p_reason text
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
begin
  if p_status not in ('skipped', 'cancelled') then
    raise exception 'invalid_planning_status';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'planning_reason_required';
  end if;

  select * into v_before
  from public.planning_occurrences
  where id = p_occurrence_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'planning_occurrence_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'stale_planning_occurrence'; end if;
  if (v_before.start_at is not null and v_before.start_at <= now())
     or (v_before.start_date is not null
         and v_before.start_date <= (now() at time zone 'Europe/Berlin')::date) then
    raise exception 'started_planning_occurrence_immutable';
  end if;

  update public.planning_occurrences
  set status = p_status,
      is_exception = series_id is not null or is_exception,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_occurrence_id
  returning * into v_after;

  insert into public.planning_events (
    organization_id, series_id, occurrence_id, event_type, mutation_scope,
    before_state, after_state, reason, created_by
  ) values (
    p_organization_id, v_before.series_id, p_occurrence_id,
    case when p_status = 'skipped' then 'skipped' else 'cancelled' end,
    'one', to_jsonb(v_before), to_jsonb(v_after), trim(p_reason), p_actor_id
  );

  if v_before.job_id is not null then
    perform app_private.project_plan_onto_job(
      p_organization_id, v_before.job_id, p_actor_id, '{}'::uuid[]
    );
  end if;

  return v_after.version;
end;
$$;
