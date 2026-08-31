drop index if exists public.maintenance_coverage_events_org_fk_idx;
drop index if exists public.maintenance_plan_events_org_fk_idx;
drop index if exists public.maintenance_due_work_events_org_fk_idx;

create or replace function public.complete_maintenance_due_work(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_scope_outcome public.maintenance_scope_outcome,
  p_completed_on date,
  p_work_artifact_revision_ids uuid[],
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_before public.maintenance_due_work%rowtype;
  v_after public.maintenance_due_work%rowtype;
  v_revision public.maintenance_plan_revisions%rowtype;
  v_next_due_date date;
  v_next_due_id uuid;
  v_payload jsonb := jsonb_build_object(
    'scopeOutcome', p_scope_outcome,
    'completedOn', p_completed_on,
    'workArtifactRevisionIds', p_work_artifact_revision_ids
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_complete', p_idempotency_key);
  if p_work_artifact_revision_ids is null
     or cardinality(p_work_artifact_revision_ids) not between 1 and 50
     or array_position(p_work_artifact_revision_ids, null) is not null then
    raise exception 'maintenance_due_evidence_required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  select * into v_existing from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id and event.request_operation = 'due_complete'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    select * into strict v_after from public.maintenance_due_work due_work
    where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id;
    return v_after;
  end if;
  select * into v_before from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_before.status <> 'visit_created' or v_before.job_id is null then raise exception 'maintenance_due_completion_not_allowed'; end if;
  if p_completed_on is null
     or p_completed_on < v_before.window_start_date
     or p_completed_on > (timezone('Europe/Berlin', now()))::date then
    raise exception 'maintenance_completion_date_invalid';
  end if;
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = v_before.maintenance_plan_revision_id and revision.organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_due_evidence_links (
    organization_id, maintenance_due_work_id, work_artifact_revision_id, created_by
  )
  select distinct
    p_organization_id, p_maintenance_due_work_id, evidence.revision_id, p_actor_id
  from unnest(p_work_artifact_revision_ids) as evidence(revision_id)
  on conflict (maintenance_due_work_id, work_artifact_revision_id) do nothing;
  if v_revision.next_due_basis = 'actual_completion_date' then
    v_next_due_date := app_private.add_months_clamped(p_completed_on, v_revision.interval_months);
  else
    v_next_due_date := app_private.add_months_clamped(v_before.original_due_date, v_revision.interval_months);
  end if;
  update public.maintenance_due_work due_work set status = 'completed',
    scope_outcome = p_scope_outcome, completed_on = p_completed_on,
    next_due_date = v_next_due_date, exception_reason = null,
    version = due_work.version + 1, updated_by = p_actor_id, updated_at = now()
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);

  if v_revision.next_due_basis = 'actual_completion_date' then
    v_next_due_id := gen_random_uuid();
    perform set_config('app.maintenance_write', 'true', true);
    insert into public.maintenance_due_work (
      id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
      original_due_date, due_date, window_start_date, window_end_date,
      created_by, updated_by
    ) values (
      v_next_due_id, p_organization_id, v_before.maintenance_plan_id, v_revision.id,
      v_next_due_date, v_next_due_date,
      v_next_due_date - v_revision.due_window_before_days,
      v_next_due_date + v_revision.due_window_after_days,
      p_actor_id, p_actor_id
    ) on conflict (maintenance_plan_id, maintenance_plan_revision_id, original_due_date)
      do nothing returning id into v_next_due_id;
    perform set_config('app.maintenance_write', 'false', true);
    if v_next_due_id is not null then
      perform app_private.record_maintenance_due_event(
        p_organization_id, v_next_due_id, 'generated', p_actor_id, null,
        'due_generated', v_next_due_id, jsonb_build_object('dueDate', v_next_due_date),
        null, app_private.maintenance_due_snapshot(v_next_due_id, p_organization_id)
      );
    end if;
  end if;
  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, 'completed', p_actor_id, p_reason,
    'due_complete', p_idempotency_key, v_payload, to_jsonb(v_before),
    app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_after;
end;
$$;

create or replace function public.unlink_maintenance_coverage_document(
  p_organization_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_coverage_events%rowtype;
  v_link public.document_links%rowtype;
  v_coverage public.maintenance_coverages%rowtype;
  v_document public.documents%rowtype;
  v_payload jsonb;
  v_before_snapshot jsonb;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(
    p_organization_id, 'document_unlink', p_idempotency_key
  );
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_reason_required';
  end if;
  select * into v_existing
  from public.maintenance_coverage_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'document_unlink'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload->>'documentLinkId' <> p_link_id::text then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    return true;
  end if;
  select * into v_link from public.document_links link
  where link.id = p_link_id and link.organization_id = p_organization_id
    and link.maintenance_coverage_id is not null for update;
  if not found then raise exception 'maintenance_coverage_document_link_not_found'; end if;
  select * into strict v_coverage from public.maintenance_coverages coverage
  where coverage.id = v_link.maintenance_coverage_id
    and coverage.organization_id = p_organization_id for update;
  if v_coverage.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  select * into strict v_document from public.documents document
  where document.id = v_link.document_id and document.organization_id = p_organization_id;
  v_payload := jsonb_build_object(
    'documentLinkId', v_link.id,
    'documentId', v_document.id,
    'documentVersionNumber', v_document.current_version_number,
    'documentStoragePath', v_document.storage_path,
    'reason', btrim(p_reason)
  );
  v_before_snapshot := app_private.maintenance_coverage_snapshot(v_coverage.id, p_organization_id);
  perform set_config('app.maintenance_coverage_document_unlink', 'true', true);
  delete from public.document_links where id = p_link_id and organization_id = p_organization_id;
  perform set_config('app.maintenance_coverage_document_unlink', 'false', true);
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_coverages set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_coverage.id and organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_coverage_event(
    p_organization_id, v_coverage.id, 'document_unlinked', p_actor_id,
    p_reason, 'document_unlink', p_idempotency_key, v_payload,
    v_before_snapshot,
    app_private.maintenance_coverage_snapshot(v_coverage.id, p_organization_id)
  );
  return true;
end;
$$;

create or replace function public.set_maintenance_due_occurrence(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_planning_occurrence_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_before public.maintenance_due_work%rowtype;
  v_after public.maintenance_due_work%rowtype;
  v_previous_maintenance_write text := current_setting('app.maintenance_write', true);
  v_payload jsonb := jsonb_build_object(
    'planningOccurrenceId', p_planning_occurrence_id
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(
    p_organization_id, 'due_occurrence_set', p_idempotency_key
  );
  select * into v_existing
  from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'due_occurrence_set'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or v_existing.request_payload <> v_payload then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_after
    from public.maintenance_due_work due_work
    where due_work.id = p_maintenance_due_work_id
      and due_work.organization_id = p_organization_id;
    return v_after;
  end if;

  select * into v_before
  from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id
  for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'maintenance_stale_version';
  end if;
  if v_before.status <> 'visit_created' or v_before.job_id is null then
    raise exception 'maintenance_due_schedule_not_allowed';
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_due_work due_work set
    planning_occurrence_id = p_planning_occurrence_id,
    version = due_work.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id
  returning * into v_after;
  perform set_config(
    'app.maintenance_write',
    coalesce(nullif(v_previous_maintenance_write, ''), 'false'),
    true
  );

  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, 'visit_rescheduled',
    p_actor_id, 'Termin geplant', 'due_occurrence_set', p_idempotency_key,
    v_payload, to_jsonb(v_before),
    app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_after;
end;
$$;

create or replace function public.link_maintenance_due_visit(
  p_organization_id uuid,
  p_maintenance_due_work_ids uuid[],
  p_job_id uuid,
  p_planning_occurrence_id uuid,
  p_expected_versions bigint[],
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns setof public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_due_id uuid;
  v_expected bigint;
  v_before jsonb;
  v_after public.maintenance_due_work%rowtype;
  v_existing_count integer;
  v_matching_count integer;
  v_payload jsonb := jsonb_build_object(
    'jobId', p_job_id,
    'planningOccurrenceId', p_planning_occurrence_id
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(
    p_organization_id, 'due_visit_link', p_idempotency_key
  );
  if p_maintenance_due_work_ids is null
     or p_expected_versions is null
     or cardinality(p_maintenance_due_work_ids) not between 1 and 20
     or cardinality(p_maintenance_due_work_ids) <> cardinality(p_expected_versions)
     or array_position(p_maintenance_due_work_ids, null) is not null
     or array_position(p_expected_versions, null) is not null
     or (
       select count(distinct value)
       from unnest(p_maintenance_due_work_ids) as input(value)
     ) <> cardinality(p_maintenance_due_work_ids) then
    raise exception 'maintenance_due_batch_invalid';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_reason_required';
  end if;

  select
    count(*),
    count(*) filter (
      where event.maintenance_due_work_id = any(p_maintenance_due_work_ids)
        and event.request_payload = v_payload
    )
  into v_existing_count, v_matching_count
  from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id
    and event.idempotency_key = p_idempotency_key
    and event.request_operation like 'due_visit_link:%';

  if v_existing_count > 0 then
    if v_existing_count <> cardinality(p_maintenance_due_work_ids)
       or v_matching_count <> cardinality(p_maintenance_due_work_ids) then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    if (
      select count(*)
      from unnest(p_maintenance_due_work_ids) as requested(id)
      join public.maintenance_due_work due_work
        on due_work.id = requested.id
       and due_work.organization_id = p_organization_id
    ) <> cardinality(p_maintenance_due_work_ids) then
      raise exception 'maintenance_due_not_found';
    end if;
    return query
      select due_work.*
      from unnest(p_maintenance_due_work_ids) with ordinality as requested(id, ordinal)
      join public.maintenance_due_work due_work
        on due_work.id = requested.id
       and due_work.organization_id = p_organization_id
      order by requested.ordinal;
    return;
  end if;

  for v_index in 1..cardinality(p_maintenance_due_work_ids) loop
    v_due_id := p_maintenance_due_work_ids[v_index];
    v_expected := p_expected_versions[v_index];
    select app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    into v_before;
    if v_before is null then raise exception 'maintenance_due_not_found'; end if;
    if (v_before->>'version')::bigint <> v_expected then
      raise exception 'maintenance_stale_version';
    end if;
    if (v_before->>'status') <> 'open' then
      raise exception 'maintenance_due_visit_not_allowed';
    end if;
    perform set_config('app.maintenance_write', 'true', true);
    update public.maintenance_due_work due_work set
      job_id = p_job_id,
      planning_occurrence_id = p_planning_occurrence_id,
      status = 'visit_created',
      version = due_work.version + 1,
      updated_by = p_actor_id,
      updated_at = now()
    where due_work.id = v_due_id
      and due_work.organization_id = p_organization_id
    returning * into v_after;
    perform set_config('app.maintenance_write', 'false', true);
    perform app_private.record_maintenance_due_event(
      p_organization_id,
      v_due_id,
      case
        when v_index = 1 then 'visit_linked'::public.maintenance_due_event_type
        else 'combined'
      end,
      p_actor_id,
      p_reason,
      'due_visit_link:' || v_due_id::text,
      p_idempotency_key,
      v_payload,
      v_before,
      app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    );
    return next v_after;
  end loop;
end;
$$;
