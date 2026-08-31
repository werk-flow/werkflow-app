create or replace function public.update_maintenance_coverage(
  p_organization_id uuid,
  p_maintenance_coverage_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_coverages
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_coverage_events%rowtype;
  v_before public.maintenance_coverages%rowtype;
  v_after public.maintenance_coverages%rowtype;
  v_before_snapshot jsonb;
  v_event_type public.maintenance_coverage_event_type :=
    'updated'::public.maintenance_coverage_event_type;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'coverage_update', p_idempotency_key);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_reason_required';
  end if;
  select * into v_existing from public.maintenance_coverage_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'coverage_update'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_coverage_id <> p_maintenance_coverage_id
       or v_existing.request_payload <> p_payload then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_after from public.maintenance_coverages coverage
    where coverage.id = p_maintenance_coverage_id and coverage.organization_id = p_organization_id;
    return v_after;
  end if;
  select * into v_before from public.maintenance_coverages coverage
  where coverage.id = p_maintenance_coverage_id
    and coverage.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_coverage_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  v_before_snapshot := app_private.maintenance_coverage_snapshot(p_maintenance_coverage_id, p_organization_id);
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_coverages coverage set
    reference = case when p_payload ? 'reference' then nullif(btrim(p_payload->>'reference'), '') else coverage.reference end,
    description = case when p_payload ? 'description' then nullif(btrim(p_payload->>'description'), '') else coverage.description end,
    status = case when p_payload ? 'status' then (p_payload->>'status')::public.maintenance_coverage_status else coverage.status end,
    valid_from = case when p_payload ? 'validFrom' then nullif(p_payload->>'validFrom', '')::date else coverage.valid_from end,
    valid_until = case when p_payload ? 'validUntil' then nullif(p_payload->>'validUntil', '')::date else coverage.valid_until end,
    notice_date = case when p_payload ? 'noticeDate' then nullif(p_payload->>'noticeDate', '')::date else coverage.notice_date end,
    renewal_date = case when p_payload ? 'renewalDate' then nullif(p_payload->>'renewalDate', '')::date else coverage.renewal_date end,
    review_due_date = case when p_payload ? 'reviewDueDate' then nullif(p_payload->>'reviewDueDate', '')::date else coverage.review_due_date end,
    operational_note = case when p_payload ? 'operationalNote' then nullif(btrim(p_payload->>'operationalNote'), '') else coverage.operational_note end,
    version = coverage.version + 1, updated_by = p_actor_id, updated_at = now()
  where coverage.id = p_maintenance_coverage_id
    and coverage.organization_id = p_organization_id returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);
  if v_before.status is distinct from v_after.status then v_event_type := 'status_changed'; end if;
  perform app_private.record_maintenance_coverage_event(
    p_organization_id, p_maintenance_coverage_id, v_event_type, p_actor_id, p_reason,
    'coverage_update', p_idempotency_key, p_payload, v_before_snapshot,
    app_private.maintenance_coverage_snapshot(p_maintenance_coverage_id, p_organization_id)
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
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_visit_link', p_idempotency_key);
  if cardinality(p_maintenance_due_work_ids) not between 1 and 20
     or cardinality(p_maintenance_due_work_ids) <> cardinality(p_expected_versions) then
    raise exception 'maintenance_due_batch_invalid';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  for v_index in 1..cardinality(p_maintenance_due_work_ids) loop
    v_due_id := p_maintenance_due_work_ids[v_index];
    v_expected := p_expected_versions[v_index];
    select app_private.maintenance_due_snapshot(v_due_id, p_organization_id) into v_before;
    if v_before is null then raise exception 'maintenance_due_not_found'; end if;
    if (v_before->>'version')::bigint <> v_expected then raise exception 'maintenance_stale_version'; end if;
    if (v_before->>'status') <> 'open' then raise exception 'maintenance_due_visit_not_allowed'; end if;
    perform set_config('app.maintenance_write', 'true', true);
    update public.maintenance_due_work due_work set
      job_id = p_job_id, planning_occurrence_id = p_planning_occurrence_id,
      status = 'visit_created', version = due_work.version + 1,
      updated_by = p_actor_id, updated_at = now()
    where due_work.id = v_due_id and due_work.organization_id = p_organization_id
    returning * into v_after;
    perform set_config('app.maintenance_write', 'false', true);
    perform app_private.record_maintenance_due_event(
      p_organization_id, v_due_id,
      case when v_index = 1 then 'visit_linked'::public.maintenance_due_event_type else 'combined' end,
      p_actor_id, p_reason, 'due_visit_link:' || v_due_id::text, p_idempotency_key,
      jsonb_build_object('jobId', p_job_id, 'planningOccurrenceId', p_planning_occurrence_id),
      v_before, app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    );
    return next v_after;
  end loop;
end;
$$;
