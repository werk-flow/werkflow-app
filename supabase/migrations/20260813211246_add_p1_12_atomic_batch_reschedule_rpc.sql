-- P1-12 batch rescheduling: one all-or-nothing, version-checked, idempotent
-- move over an explicitly selected set of future scheduled occurrences. The
-- app precomputes Berlin wall-clock instants and the P1-11 assessment; this
-- RPC validates and applies atomically. Dispatch revisions supersede via the
-- deferred sync triggers in the same transaction.

alter table planning_events drop constraint planning_events_type_check;
alter table planning_events add constraint planning_events_type_check
  check (event_type = any (array[
    'created', 'moved', 'resized', 'reassigned', 'edited', 'series_split',
    'series_changed', 'series_stopped', 'skipped', 'cancelled',
    'override_recorded', 'legacy_synced', 'materialized', 'batch_rescheduled'
  ]::text[]));

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
  p_override_reason text
) returns uuid[]
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

revoke all on function public.batch_reschedule_planning_occurrences(uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.batch_reschedule_planning_occurrences(uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb, text, text) to service_role;