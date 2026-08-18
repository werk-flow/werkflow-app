-- Nullable RPC arguments need SQL defaults: the app client omits undefined
-- parameters entirely, and PostgREST only matches a shorter call when the
-- missing trailing parameters carry defaults. Bodies are unchanged except for
-- explicit null guards on parameters that are now defaulted but required.

drop function public.issue_planning_dispatch(uuid, uuid, uuid, uuid, uuid[], text, jsonb, text, uuid);

create function public.issue_planning_dispatch(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid default null,
  p_job_id uuid default null,
  p_recipient_employee_record_ids uuid[] default null,
  p_note text default null,
  p_readiness_snapshot jsonb default null,
  p_readiness_fingerprint text default null,
  p_request_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_existing uuid;
  v_occurrence record;
  v_job record;
  v_recipients uuid[];
  v_dispatch_id uuid;
  v_revision_id uuid;
  v_fingerprint text;
  v_schedule_text text;
  v_location text;
  v_site uuid;
  v_valid_count integer;
begin
  if p_request_id is null then
    raise exception 'dispatch_request_id_required';
  end if;
  if (p_occurrence_id is null) = (p_job_id is null) then
    raise exception 'dispatch_target_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organization_id::text || ':dispatch:' || p_request_id::text)
  );
  select id into v_existing
  from public.planning_dispatches
  where organization_id = p_organization_id and creation_request_id = p_request_id;
  if found then
    return v_existing;
  end if;

  if p_occurrence_id is not null then
    select * into v_occurrence
    from public.planning_occurrences
    where id = p_occurrence_id and organization_id = p_organization_id
    for update;
    if not found or v_occurrence.entry_kind <> 'job_visit' then
      raise exception 'dispatch_occurrence_not_found';
    end if;
    if v_occurrence.status <> 'scheduled' then
      raise exception 'dispatch_occurrence_not_scheduled';
    end if;
    select * into v_job from public.jobs
    where id = v_occurrence.job_id and organization_id = p_organization_id;
    if not found or v_job.status in ('geparkt', 'fertig') then
      raise exception 'dispatch_job_not_dispatchable';
    end if;
    select coalesce(array_agg(a.employee_record_id), '{}'::uuid[])
    into v_recipients
    from public.planning_occurrence_assignments a
    where a.occurrence_id = p_occurrence_id;
    if coalesce(array_length(v_recipients, 1), 0) = 0 then
      raise exception 'dispatch_requires_recipients';
    end if;
    v_schedule_text := coalesce(
      v_occurrence.start_at::text || '/' || v_occurrence.end_at::text,
      v_occurrence.start_date::text || '/' || v_occurrence.end_date_exclusive::text,
      'unscheduled'
    );
    v_location := coalesce(v_occurrence.location, v_job.location);
    v_site := v_job.site_id;
  else
    select * into v_job from public.jobs
    where id = p_job_id and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'dispatch_job_not_found';
    end if;
    if v_job.status = 'fertig' then
      raise exception 'dispatch_job_not_dispatchable';
    end if;
    if exists (
      select 1 from public.planning_occurrences o
      where o.job_id = p_job_id and o.status = 'scheduled'
    ) then
      raise exception 'dispatch_job_has_scheduled_visits';
    end if;
    v_recipients := (
      select coalesce(array_agg(distinct r), '{}'::uuid[])
      from unnest(coalesce(p_recipient_employee_record_ids, '{}'::uuid[])) r
    );
    if coalesce(array_length(v_recipients, 1), 0) = 0 then
      raise exception 'dispatch_requires_recipients';
    end if;
    select count(*) into v_valid_count
    from public.employee_records er
    where er.organization_id = p_organization_id and er.id = any (v_recipients);
    if v_valid_count <> array_length(v_recipients, 1) then
      raise exception 'dispatch_recipient_not_found';
    end if;
    v_schedule_text := 'unscheduled';
    v_location := v_job.location;
    v_site := v_job.site_id;
  end if;

  v_fingerprint := app_private.compute_dispatch_material_fingerprint(
    case when p_occurrence_id is not null
      then 'occurrence:' || p_occurrence_id::text
      else 'job:' || p_job_id::text end,
    v_schedule_text,
    v_location,
    v_site::text,
    p_note,
    v_recipients
  );

  insert into public.planning_dispatches (
    organization_id, occurrence_id, job_id, status, creation_request_id, created_by
  ) values (
    p_organization_id, p_occurrence_id, p_job_id, 'active', p_request_id, p_actor_id
  ) returning id into v_dispatch_id;

  insert into public.planning_dispatch_revisions (
    organization_id, dispatch_id, revision_number, change_kind,
    occurrence_id, job_id,
    planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive,
    location_text, site_id, dispatch_note, material_fingerprint,
    readiness_snapshot, readiness_fingerprint, created_by
  ) values (
    p_organization_id, v_dispatch_id, 1, 'issued',
    p_occurrence_id, p_job_id,
    case when p_occurrence_id is not null then v_occurrence.start_at end,
    case when p_occurrence_id is not null then v_occurrence.end_at end,
    case when p_occurrence_id is not null then v_occurrence.start_date end,
    case when p_occurrence_id is not null then v_occurrence.end_date_exclusive end,
    v_location, v_site, nullif(btrim(coalesce(p_note, '')), ''), v_fingerprint,
    p_readiness_snapshot, p_readiness_fingerprint, p_actor_id
  ) returning id into v_revision_id;

  insert into public.planning_dispatch_recipients
    (organization_id, dispatch_id, revision_id, employee_record_id)
  select p_organization_id, v_dispatch_id, v_revision_id, r
  from unnest(v_recipients) r;

  update public.planning_dispatches
  set current_revision_id = v_revision_id
  where id = v_dispatch_id;

  insert into public.planning_dispatch_events
    (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
  values (
    p_organization_id, v_dispatch_id, v_revision_id, 'issued',
    jsonb_build_object(
      'target', case when p_occurrence_id is not null then 'occurrence' else 'job' end,
      'recipientCount', array_length(v_recipients, 1)
    ),
    p_actor_id
  );

  return v_dispatch_id;
end;
$$;

revoke all on function public.issue_planning_dispatch(uuid, uuid, uuid, uuid, uuid[], text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_planning_dispatch(uuid, uuid, uuid, uuid, uuid[], text, jsonb, text, uuid) to service_role;

-- update_planning_dispatch_instruction: trailing optional note/recipients.
drop function public.update_planning_dispatch_instruction(uuid, uuid, uuid, integer, text, uuid[]);

create function public.update_planning_dispatch_instruction(
  p_organization_id uuid,
  p_actor_id uuid,
  p_dispatch_id uuid,
  p_expected_revision_number integer,
  p_note text default null,
  p_recipient_employee_record_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dispatch record;
  v_current record;
  v_recipients uuid[];
  v_note text;
  v_fingerprint text;
  v_change_kind public.dispatch_change_kind;
  v_new_revision_id uuid;
  v_valid_count integer;
  v_carry boolean;
begin
  select * into v_dispatch
  from public.planning_dispatches
  where id = p_dispatch_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'dispatch_not_found'; end if;
  if v_dispatch.status <> 'active' then raise exception 'dispatch_not_active'; end if;

  select * into v_current
  from public.planning_dispatch_revisions
  where id = v_dispatch.current_revision_id;
  if v_current.revision_number <> p_expected_revision_number then
    raise exception 'stale_dispatch_revision';
  end if;

  if v_dispatch.occurrence_id is not null and p_recipient_employee_record_ids is not null then
    raise exception 'dispatch_recipients_follow_assignments';
  end if;

  if p_recipient_employee_record_ids is not null then
    v_recipients := (
      select coalesce(array_agg(distinct r), '{}'::uuid[])
      from unnest(p_recipient_employee_record_ids) r
    );
    if coalesce(array_length(v_recipients, 1), 0) = 0 then
      raise exception 'dispatch_requires_recipients';
    end if;
    select count(*) into v_valid_count
    from public.employee_records er
    where er.organization_id = p_organization_id and er.id = any (v_recipients);
    if v_valid_count <> array_length(v_recipients, 1) then
      raise exception 'dispatch_recipient_not_found';
    end if;
  else
    select coalesce(array_agg(r.employee_record_id), '{}'::uuid[])
    into v_recipients
    from public.planning_dispatch_recipients r
    where r.revision_id = v_current.id;
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  v_fingerprint := app_private.compute_dispatch_material_fingerprint(
    case when v_dispatch.occurrence_id is not null
      then 'occurrence:' || v_dispatch.occurrence_id::text
      else 'job:' || v_dispatch.job_id::text end,
    coalesce(
      v_current.planned_start_at::text || '/' || v_current.planned_end_at::text,
      v_current.planned_start_date::text || '/' || v_current.planned_end_date_exclusive::text,
      'unscheduled'
    ),
    v_current.location_text,
    v_current.site_id::text,
    v_note,
    v_recipients
  );
  if v_fingerprint = v_current.material_fingerprint then
    return v_current.revision_number;
  end if;

  if v_note is distinct from v_current.dispatch_note then
    v_change_kind := 'instruction_changed';
  else
    v_change_kind := 'reassigned';
  end if;
  v_carry := v_change_kind = 'reassigned';

  insert into public.planning_dispatch_revisions (
    organization_id, dispatch_id, revision_number, change_kind,
    occurrence_id, job_id,
    planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive,
    location_text, site_id, dispatch_note, material_fingerprint, created_by
  ) values (
    p_organization_id, v_dispatch.id, v_current.revision_number + 1, v_change_kind,
    v_dispatch.occurrence_id, v_dispatch.job_id,
    v_current.planned_start_at, v_current.planned_end_at,
    v_current.planned_start_date, v_current.planned_end_date_exclusive,
    v_current.location_text, v_current.site_id, v_note, v_fingerprint, p_actor_id
  ) returning id into v_new_revision_id;

  insert into public.planning_dispatch_recipients
    (organization_id, dispatch_id, revision_id, employee_record_id)
  select p_organization_id, v_dispatch.id, v_new_revision_id, r
  from unnest(v_recipients) r;

  if v_carry then
    insert into public.planning_dispatch_acknowledgements (
      organization_id, dispatch_id, revision_id, employee_record_id,
      state, acted_by, carried_from_acknowledgement_id
    )
    select
      p_organization_id, v_dispatch.id, v_new_revision_id,
      latest.employee_record_id, 'carried_forward', p_actor_id, latest.id
    from (
      select distinct on (a.employee_record_id) a.*
      from public.planning_dispatch_acknowledgements a
      where a.revision_id = v_current.id
      order by a.employee_record_id, a.created_at desc, a.id desc
    ) latest
    where latest.state in ('acknowledged', 'carried_forward')
      and latest.employee_record_id = any (v_recipients);
  end if;

  update public.planning_dispatch_acknowledgements
  set challenge_resolved_at = now(),
      challenge_resolved_by = p_actor_id,
      challenge_resolution = 'superseded'
  where revision_id = v_current.id
    and state = 'challenged'
    and challenge_resolved_at is null;

  update public.planning_dispatches
  set current_revision_id = v_new_revision_id, updated_at = now()
  where id = v_dispatch.id;

  insert into public.planning_dispatch_events
    (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
  values (
    p_organization_id, v_dispatch.id, v_new_revision_id, 'revision_superseded',
    jsonb_build_object(
      'changeKind', v_change_kind::text,
      'previousRevisionId', v_current.id,
      'carriedForward', v_carry
    ),
    p_actor_id
  );

  return v_current.revision_number + 1;
end;
$$;

revoke all on function public.update_planning_dispatch_instruction(uuid, uuid, uuid, integer, text, uuid[]) from public, anon, authenticated;
grant execute on function public.update_planning_dispatch_instruction(uuid, uuid, uuid, integer, text, uuid[]) to service_role;

-- set_job_parking_context: trailing optional note/responsible/review date.
drop function public.set_job_parking_context(uuid, uuid, uuid, job_parking_reason, text, uuid, date);

create function public.set_job_parking_context(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_reason job_parking_reason,
  p_note text default null,
  p_responsible_employee_record_id uuid default null,
  p_next_review_date date default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job record;
  v_existing record;
  v_after jsonb;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'job_not_found'; end if;
  if v_job.status <> 'geparkt' then raise exception 'job_not_parked'; end if;

  if p_responsible_employee_record_id is not null then
    if not exists (
      select 1
      from public.employee_records er
      join public.organization_members m
        on m.organization_id = er.organization_id and m.user_id = er.user_id
      where er.id = p_responsible_employee_record_id
        and er.organization_id = p_organization_id
        and m.role in ('admin', 'buero')
    ) then
      raise exception 'responsible_not_manager';
    end if;
  end if;

  v_after := jsonb_build_object(
    'reason', p_reason::text,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'responsibleEmployeeRecordId', p_responsible_employee_record_id,
    'nextReviewDate', p_next_review_date
  );

  select * into v_existing from public.job_parking_contexts where job_id = p_job_id;
  if found then
    update public.job_parking_contexts
    set reason = p_reason,
        note = nullif(btrim(coalesce(p_note, '')), ''),
        responsible_employee_record_id = p_responsible_employee_record_id,
        next_review_date = p_next_review_date,
        updated_by = p_actor_id,
        updated_at = now()
    where job_id = p_job_id;
    insert into public.job_parking_events
      (organization_id, job_id, event_type, before_state, after_state, created_by)
    values (
      p_organization_id, p_job_id, 'context_updated',
      jsonb_build_object(
        'reason', v_existing.reason::text,
        'note', v_existing.note,
        'responsibleEmployeeRecordId', v_existing.responsible_employee_record_id,
        'nextReviewDate', v_existing.next_review_date
      ),
      v_after, p_actor_id
    );
  else
    insert into public.job_parking_contexts (
      job_id, organization_id, reason, note,
      responsible_employee_record_id, next_review_date, created_by, updated_by
    ) values (
      p_job_id, p_organization_id, p_reason,
      nullif(btrim(coalesce(p_note, '')), ''),
      p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
    );
    insert into public.job_parking_events
      (organization_id, job_id, event_type, after_state, created_by)
    values (p_organization_id, p_job_id, 'context_set', v_after, p_actor_id);
  end if;
end;
$$;

revoke all on function public.set_job_parking_context(uuid, uuid, uuid, job_parking_reason, text, uuid, date) from public, anon, authenticated;
grant execute on function public.set_job_parking_context(uuid, uuid, uuid, job_parking_reason, text, uuid, date) to service_role;

-- record_customer_commitment: optional window/source/contact tail (source is
-- validated as required inside).
drop function public.record_customer_commitment(uuid, uuid, uuid, date, time, time, customer_commitment_source, uuid);

create function public.record_customer_commitment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid,
  p_committed_date date,
  p_window_start_time time default null,
  p_window_end_time time default null,
  p_source customer_commitment_source default null,
  p_contact_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_occurrence record;
  v_active record;
  v_commitment_id uuid;
begin
  if p_source is null then
    raise exception 'commitment_source_required';
  end if;
  select * into v_occurrence
  from public.planning_occurrences
  where id = p_occurrence_id and organization_id = p_organization_id
  for update;
  if not found or v_occurrence.entry_kind <> 'job_visit' then
    raise exception 'commitment_occurrence_not_found';
  end if;
  if v_occurrence.status <> 'scheduled' then
    raise exception 'commitment_occurrence_not_scheduled';
  end if;

  select * into v_active
  from public.planning_customer_commitments
  where occurrence_id = p_occurrence_id and status = 'active'
  for update;
  if found then
    update public.planning_customer_commitments
    set status = 'superseded',
        status_changed_by = p_actor_id,
        status_changed_at = now()
    where id = v_active.id;
    insert into public.planning_customer_commitment_events
      (organization_id, commitment_id, event_type, payload, created_by)
    values (
      p_organization_id, v_active.id, 'superseded',
      jsonb_build_object('supersededByNewCommitment', true), p_actor_id
    );
  end if;

  insert into public.planning_customer_commitments (
    organization_id, occurrence_id, committed_date,
    window_start_time, window_end_time, source, contact_id,
    status, supersedes_id, recorded_by
  ) values (
    p_organization_id, p_occurrence_id, p_committed_date,
    p_window_start_time, p_window_end_time, p_source, p_contact_id,
    'active', v_active.id, p_actor_id
  ) returning id into v_commitment_id;

  insert into public.planning_customer_commitment_events
    (organization_id, commitment_id, event_type, payload, created_by)
  values (
    p_organization_id, v_commitment_id, 'recorded',
    jsonb_build_object(
      'committedDate', p_committed_date,
      'windowStartTime', p_window_start_time,
      'windowEndTime', p_window_end_time,
      'source', p_source::text,
      'contactId', p_contact_id,
      'supersedesId', v_active.id
    ),
    p_actor_id
  );
  return v_commitment_id;
end;
$$;

revoke all on function public.record_customer_commitment(uuid, uuid, uuid, date, time, time, customer_commitment_source, uuid) from public, anon, authenticated;
grant execute on function public.record_customer_commitment(uuid, uuid, uuid, date, time, time, customer_commitment_source, uuid) to service_role;

-- batch reschedule: optional trailing override reason.
alter function public.batch_reschedule_planning_occurrences(uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb, text, text) rename to batch_reschedule_planning_occurrences_old;
drop function public.batch_reschedule_planning_occurrences_old(uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb, text, text);

create function public.batch_reschedule_planning_occurrences(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text,
  p_items jsonb,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text,
  p_override_reason text default null
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
  v_job_id uuid;
  v_projection record;
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

  perform set_config('app.planning_projection_write', 'true', true);
  for v_job_id in
    select distinct o.job_id
    from public.planning_occurrences o
    where o.id = any (v_ids) and o.job_id is not null
  loop
    select occurrence.start_at, occurrence.start_date, occurrence.end_at
    into v_projection
    from public.planning_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.job_id = v_job_id
      and occurrence.status = 'scheduled'
    order by coalesce(occurrence.start_at, occurrence.start_date::timestamptz)
    limit 1;
    if found then
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