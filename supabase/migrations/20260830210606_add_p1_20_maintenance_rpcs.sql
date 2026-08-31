create or replace function app_private.assert_maintenance_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.maintenance_actor_is_manager(p_organization_id, p_actor_id) then
    raise exception 'maintenance_not_authorized';
  end if;
end;
$$;

create or replace function app_private.lock_maintenance_operation(
  p_organization_id uuid,
  p_operation text,
  p_idempotency_key uuid
)
returns void language sql volatile set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_operation || ':' || p_idempotency_key::text,
      0
    )
  );
$$;

create or replace function app_private.next_maintenance_number(
  p_organization_id uuid,
  p_kind text
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_prefix text;
  v_next integer;
begin
  if p_kind = 'coverage' then v_prefix := 'WDV';
  elsif p_kind = 'plan' then v_prefix := 'WPL';
  else raise exception 'maintenance_number_kind_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':maintenance-number:' || p_kind, 0)
  );
  if p_kind = 'coverage' then
    select coalesce(max(substring(coverage.coverage_number from
      ('^' || v_prefix || '-' || v_year || '-([0-9]+)$'))::integer), 0) + 1
    into v_next
    from public.maintenance_coverages coverage
    where coverage.organization_id = p_organization_id
      and coverage.coverage_number ~ ('^' || v_prefix || '-' || v_year || '-[0-9]+$');
  else
    select coalesce(max(substring(plan.plan_number from
      ('^' || v_prefix || '-' || v_year || '-([0-9]+)$'))::integer), 0) + 1
    into v_next
    from public.maintenance_plans plan
    where plan.organization_id = p_organization_id
      and plan.plan_number ~ ('^' || v_prefix || '-' || v_year || '-[0-9]+$');
  end if;
  return v_prefix || '-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function app_private.add_months_clamped(
  p_date date,
  p_months integer
)
returns date language sql immutable set search_path = ''
as $$
  select (
    date_trunc('month', p_date)::date
    + make_interval(months => p_months)
    + make_interval(days => (
      least(
        extract(day from p_date)::integer,
        extract(day from (
          date_trunc('month', p_date)::date
          + make_interval(months => p_months + 1)
          - interval '1 day'
        ))::integer
      ) - 1
    ))
  )::date;
$$;

create or replace function app_private.maintenance_coverage_snapshot(
  p_maintenance_coverage_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(coverage)
  from public.maintenance_coverages coverage
  where coverage.id = p_maintenance_coverage_id
    and coverage.organization_id = p_organization_id;
$$;

create or replace function app_private.maintenance_plan_snapshot(
  p_maintenance_plan_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(plan) || jsonb_build_object(
    'equipmentIds', coalesce((
      select jsonb_agg(link.equipment_id order by link.equipment_id)
      from public.maintenance_plan_revision_equipment link
      where link.maintenance_plan_revision_id = plan.current_revision_id
        and link.organization_id = plan.organization_id
    ), '[]'::jsonb)
  )
  from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id
    and plan.organization_id = p_organization_id;
$$;

create or replace function app_private.maintenance_due_snapshot(
  p_maintenance_due_work_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(due_work)
  from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id;
$$;

create or replace function app_private.record_maintenance_coverage_event(
  p_organization_id uuid,
  p_maintenance_coverage_id uuid,
  p_event_type public.maintenance_coverage_event_type,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid,
  p_request_payload jsonb,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_event_id uuid;
begin
  insert into public.maintenance_coverage_events (
    organization_id, maintenance_coverage_id, event_type, actor_id, reason,
    request_operation, idempotency_key, request_payload, before_snapshot, after_snapshot
  ) values (
    p_organization_id, p_maintenance_coverage_id, p_event_type, p_actor_id,
    nullif(btrim(p_reason), ''), btrim(p_request_operation), p_idempotency_key,
    p_request_payload, p_before_snapshot, p_after_snapshot
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function app_private.record_maintenance_plan_event(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_event_type public.maintenance_plan_event_type,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid,
  p_request_payload jsonb,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_event_id uuid;
begin
  insert into public.maintenance_plan_events (
    organization_id, maintenance_plan_id, event_type, actor_id, reason,
    request_operation, idempotency_key, request_payload, before_snapshot, after_snapshot
  ) values (
    p_organization_id, p_maintenance_plan_id, p_event_type, p_actor_id,
    nullif(btrim(p_reason), ''), btrim(p_request_operation), p_idempotency_key,
    p_request_payload, p_before_snapshot, p_after_snapshot
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function app_private.record_maintenance_due_event(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_event_type public.maintenance_due_event_type,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid,
  p_request_payload jsonb,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_event_id uuid;
begin
  insert into public.maintenance_due_work_events (
    organization_id, maintenance_due_work_id, event_type, actor_id, reason,
    request_operation, idempotency_key, request_payload, before_snapshot, after_snapshot
  ) values (
    p_organization_id, p_maintenance_due_work_id, p_event_type, p_actor_id,
    nullif(btrim(p_reason), ''), btrim(p_request_operation), p_idempotency_key,
    p_request_payload, p_before_snapshot, p_after_snapshot
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function app_private.assert_maintenance_equipment_set(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_client_id uuid,
  p_site_id uuid,
  p_equipment_ids jsonb,
  p_overlap_reason text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if jsonb_typeof(coalesce(p_equipment_ids, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_equipment_ids, '[]'::jsonb)) not between 1 and 50 then
    raise exception 'maintenance_equipment_ids_invalid';
  end if;

  select count(*) into v_count
  from (
    select distinct value::text::uuid as equipment_id
    from jsonb_array_elements_text(p_equipment_ids) value
  ) requested;
  if v_count <> jsonb_array_length(p_equipment_ids) then
    raise exception 'maintenance_equipment_ids_duplicate';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_equipment_ids) value
    left join public.installed_equipment equipment
      on equipment.id = value::text::uuid
     and equipment.organization_id = p_organization_id
     and equipment.client_id = p_client_id
     and equipment.site_id = p_site_id
     and equipment.archived_at is null
     and equipment.voided_at is null
    where equipment.id is null
  ) then raise exception 'maintenance_plan_equipment_mismatch'; end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_equipment_ids) value
    join public.maintenance_plan_revision_equipment link
      on link.equipment_id = value::text::uuid
     and link.organization_id = p_organization_id
    join public.maintenance_plans other_plan
      on other_plan.current_revision_id = link.maintenance_plan_revision_id
     and other_plan.organization_id = p_organization_id
    where other_plan.id <> p_maintenance_plan_id
      and other_plan.status in ('active', 'suspended')
      and other_plan.archived_at is null
  ) and length(btrim(coalesce(p_overlap_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_overlap_reason_required';
  end if;
end;
$$;

create or replace function app_private.insert_maintenance_revision_equipment(
  p_organization_id uuid,
  p_revision_id uuid,
  p_actor_id uuid,
  p_equipment_ids jsonb
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_plan_revision_equipment (
    organization_id, maintenance_plan_revision_id, equipment_id, created_by
  )
  select p_organization_id, p_revision_id, value::text::uuid, p_actor_id
  from jsonb_array_elements_text(p_equipment_ids) value;
  perform set_config('app.maintenance_write', 'false', true);
end;
$$;

create or replace function public.create_maintenance_coverage(
  p_organization_id uuid,
  p_maintenance_coverage_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_coverages
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_coverage_events%rowtype;
  v_coverage public.maintenance_coverages%rowtype;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'coverage_create', p_idempotency_key);
  select * into v_existing from public.maintenance_coverage_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'coverage_create'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_coverage_id <> p_maintenance_coverage_id
       or v_existing.request_payload <> p_payload then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_coverage from public.maintenance_coverages coverage
    where coverage.id = p_maintenance_coverage_id
      and coverage.organization_id = p_organization_id;
    return v_coverage;
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_coverages (
    id, organization_id, coverage_number, client_id, site_id, reference,
    description, status, valid_from, valid_until, notice_date, renewal_date,
    review_due_date, operational_note, created_by, updated_by
  ) values (
    p_maintenance_coverage_id, p_organization_id,
    app_private.next_maintenance_number(p_organization_id, 'coverage'),
    nullif(p_payload->>'clientId', '')::uuid,
    nullif(p_payload->>'siteId', '')::uuid,
    nullif(btrim(p_payload->>'reference'), ''),
    nullif(btrim(p_payload->>'description'), ''),
    coalesce(nullif(p_payload->>'status', '')::public.maintenance_coverage_status, 'active'),
    nullif(p_payload->>'validFrom', '')::date,
    nullif(p_payload->>'validUntil', '')::date,
    nullif(p_payload->>'noticeDate', '')::date,
    nullif(p_payload->>'renewalDate', '')::date,
    nullif(p_payload->>'reviewDueDate', '')::date,
    nullif(btrim(p_payload->>'operationalNote'), ''),
    p_actor_id, p_actor_id
  ) returning * into v_coverage;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_coverage_event(
    p_organization_id, p_maintenance_coverage_id, 'created', p_actor_id, null,
    'coverage_create', p_idempotency_key, p_payload, null,
    app_private.maintenance_coverage_snapshot(p_maintenance_coverage_id, p_organization_id)
  );
  return v_coverage;
end;
$$;

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

create or replace function public.create_maintenance_plan(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_revision_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_client_id uuid := nullif(p_payload->>'clientId', '')::uuid;
  v_site_id uuid := nullif(p_payload->>'siteId', '')::uuid;
  v_status public.maintenance_plan_status := coalesce(
    nullif(p_payload->>'status', '')::public.maintenance_plan_status, 'draft'
  );
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_create', p_idempotency_key);
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_create'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> p_payload then
      raise exception 'maintenance_idempotency_conflict';
    end if;
    select * into strict v_plan from public.maintenance_plans plan
    where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
    return v_plan;
  end if;
  if v_status = 'terminated' then raise exception 'maintenance_plan_initial_status_invalid'; end if;
  perform app_private.assert_maintenance_equipment_set(
    p_organization_id, p_maintenance_plan_id, v_client_id, v_site_id,
    p_payload->'equipmentIds', p_payload->>'overlapReason'
  );
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_plans (
    id, organization_id, plan_number, client_id, site_id,
    maintenance_coverage_id, status, created_by, updated_by
  ) values (
    p_maintenance_plan_id, p_organization_id,
    app_private.next_maintenance_number(p_organization_id, 'plan'),
    v_client_id, v_site_id,
    nullif(p_payload->>'maintenanceCoverageId', '')::uuid,
    v_status, p_actor_id, p_actor_id
  );
  insert into public.maintenance_plan_revisions (
    id, organization_id, maintenance_plan_id, revision_number,
    template_version_id, effective_from_date, first_due_date, interval_months,
    due_window_before_days, due_window_after_days, planned_duration_minutes,
    next_due_basis, operational_instructions, overlap_reason, reason, created_by
  ) values (
    p_revision_id, p_organization_id, p_maintenance_plan_id, 1,
    nullif(p_payload->>'templateVersionId', '')::uuid,
    (p_payload->>'effectiveFromDate')::date,
    (p_payload->>'firstDueDate')::date,
    (p_payload->>'intervalMonths')::integer,
    coalesce((p_payload->>'dueWindowBeforeDays')::integer, 0),
    coalesce((p_payload->>'dueWindowAfterDays')::integer, 0),
    (p_payload->>'plannedDurationMinutes')::integer,
    (p_payload->>'nextDueBasis')::public.maintenance_next_due_basis,
    nullif(btrim(p_payload->>'operationalInstructions'), ''),
    nullif(btrim(p_payload->>'overlapReason'), ''),
    coalesce(nullif(btrim(p_payload->>'reason'), ''), 'Wartungsplan angelegt'),
    p_actor_id
  );
  update public.maintenance_plans set current_revision_id = p_revision_id
  where id = p_maintenance_plan_id and organization_id = p_organization_id
  returning * into v_plan;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.insert_maintenance_revision_equipment(
    p_organization_id, p_revision_id, p_actor_id, p_payload->'equipmentIds'
  );
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id, 'created', p_actor_id,
    nullif(btrim(p_payload->>'reason'), ''), 'plan_create', p_idempotency_key,
    p_payload, null, app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return v_plan;
end;
$$;

create or replace function public.revise_maintenance_plan(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_before public.maintenance_plans%rowtype;
  v_after public.maintenance_plans%rowtype;
  v_before_snapshot jsonb;
  v_revision_number integer;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_revise', p_idempotency_key);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'maintenance_reason_required';
  end if;
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_revise'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> p_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    select * into strict v_after from public.maintenance_plans plan
    where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
    return v_after;
  end if;
  select * into v_before from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_plan_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_before.status = 'terminated' or v_before.archived_at is not null then
    raise exception 'maintenance_plan_revision_not_allowed';
  end if;
  perform app_private.assert_maintenance_equipment_set(
    p_organization_id, p_maintenance_plan_id, v_before.client_id, v_before.site_id,
    p_payload->'equipmentIds', p_payload->>'overlapReason'
  );
  select coalesce(max(revision.revision_number), 0) + 1 into v_revision_number
  from public.maintenance_plan_revisions revision
  where revision.maintenance_plan_id = p_maintenance_plan_id;
  v_before_snapshot := app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id);
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_plan_revisions (
    id, organization_id, maintenance_plan_id, revision_number,
    template_version_id, effective_from_date, first_due_date, interval_months,
    due_window_before_days, due_window_after_days, planned_duration_minutes,
    next_due_basis, operational_instructions, overlap_reason, reason, created_by
  ) values (
    p_revision_id, p_organization_id, p_maintenance_plan_id, v_revision_number,
    nullif(p_payload->>'templateVersionId', '')::uuid,
    (p_payload->>'effectiveFromDate')::date, (p_payload->>'firstDueDate')::date,
    (p_payload->>'intervalMonths')::integer,
    coalesce((p_payload->>'dueWindowBeforeDays')::integer, 0),
    coalesce((p_payload->>'dueWindowAfterDays')::integer, 0),
    (p_payload->>'plannedDurationMinutes')::integer,
    (p_payload->>'nextDueBasis')::public.maintenance_next_due_basis,
    nullif(btrim(p_payload->>'operationalInstructions'), ''),
    nullif(btrim(p_payload->>'overlapReason'), ''), btrim(p_reason), p_actor_id
  );
  update public.maintenance_plans plan set
    current_revision_id = p_revision_id,
    generation_through_date = null,
    version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.insert_maintenance_revision_equipment(
    p_organization_id, p_revision_id, p_actor_id, p_payload->'equipmentIds'
  );
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id, 'revised', p_actor_id, p_reason,
    'plan_revise', p_idempotency_key, p_payload, v_before_snapshot,
    app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return v_after;
end;
$$;

create or replace function public.transition_maintenance_plan(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_expected_version bigint,
  p_to_status public.maintenance_plan_status,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_before public.maintenance_plans%rowtype;
  v_after public.maintenance_plans%rowtype;
  v_payload jsonb := jsonb_build_object('toStatus', p_to_status);
  v_allowed boolean;
  v_before_snapshot jsonb;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_transition', p_idempotency_key);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_transition'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    select * into strict v_after from public.maintenance_plans plan
    where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
    return v_after;
  end if;
  select * into v_before from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_plan_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  v_allowed := case v_before.status
    when 'draft' then p_to_status in ('active', 'terminated')
    when 'active' then p_to_status in ('suspended', 'terminated')
    when 'suspended' then p_to_status in ('active', 'terminated')
    else false end;
  if not v_allowed then raise exception 'maintenance_plan_transition_not_allowed'; end if;
  v_before_snapshot := app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id);
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_plans plan set status = p_to_status,
    version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id, 'status_changed', p_actor_id, p_reason,
    'plan_transition', p_idempotency_key, v_payload, v_before_snapshot,
    app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return v_after;
end;
$$;

create or replace function public.set_maintenance_plan_archived(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_expected_version bigint,
  p_archived boolean,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_before public.maintenance_plans%rowtype;
  v_after public.maintenance_plans%rowtype;
  v_payload jsonb := jsonb_build_object('archived', p_archived);
  v_before_snapshot jsonb;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_archive', p_idempotency_key);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_archive'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    select * into strict v_after from public.maintenance_plans plan
    where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
    return v_after;
  end if;
  select * into v_before from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_plan_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_before.status <> 'terminated' then raise exception 'maintenance_plan_archive_requires_terminated'; end if;
  v_before_snapshot := app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id);
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_plans plan set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then p_actor_id else null end,
    version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id,
    case when p_archived then 'archived'::public.maintenance_plan_event_type else 'restored' end,
    p_actor_id, p_reason, 'plan_archive', p_idempotency_key, v_payload,
    v_before_snapshot, app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return v_after;
end;
$$;

create or replace function public.generate_maintenance_due_work(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_expected_version bigint,
  p_through_date date,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns setof public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_plan_events%rowtype;
  v_plan public.maintenance_plans%rowtype;
  v_revision public.maintenance_plan_revisions%rowtype;
  v_due_date date;
  v_due_id uuid;
  v_before_snapshot jsonb;
  v_payload jsonb := jsonb_build_object('throughDate', p_through_date);
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'plan_generate', p_idempotency_key);
  select * into v_existing from public.maintenance_plan_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'plan_generate'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_plan_id <> p_maintenance_plan_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    return query select due_work.* from public.maintenance_due_work due_work
    where due_work.maintenance_plan_id = p_maintenance_plan_id
      and due_work.organization_id = p_organization_id and due_work.due_date <= p_through_date
    order by due_work.due_date, due_work.id;
    return;
  end if;
  select * into v_plan from public.maintenance_plans plan
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_plan_not_found'; end if;
  if v_plan.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_plan.status <> 'active' or v_plan.archived_at is not null then raise exception 'maintenance_plan_generation_not_allowed'; end if;
  if p_through_date < current_date or p_through_date > current_date + interval '18 months' then
    raise exception 'maintenance_generation_horizon_invalid';
  end if;
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = v_plan.current_revision_id and revision.organization_id = p_organization_id;
  v_before_snapshot := app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id);

  if v_revision.next_due_basis = 'planned_due_date' then
    v_due_date := v_revision.first_due_date;
    while v_due_date <= p_through_date loop
      if v_due_date >= v_revision.effective_from_date then
        v_due_id := gen_random_uuid();
        perform set_config('app.maintenance_write', 'true', true);
        insert into public.maintenance_due_work (
          id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
          original_due_date, due_date, window_start_date, window_end_date,
          created_by, updated_by
        ) values (
          v_due_id, p_organization_id, p_maintenance_plan_id, v_revision.id,
          v_due_date, v_due_date,
          v_due_date - v_revision.due_window_before_days,
          v_due_date + v_revision.due_window_after_days,
          p_actor_id, p_actor_id
        ) on conflict (maintenance_plan_id, maintenance_plan_revision_id, original_due_date)
          do nothing returning id into v_due_id;
        perform set_config('app.maintenance_write', 'false', true);
        if v_due_id is not null then
          perform app_private.record_maintenance_due_event(
            p_organization_id, v_due_id, 'generated', p_actor_id, null,
            'due_generated', v_due_id, jsonb_build_object('dueDate', v_due_date),
            null, app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
          );
        end if;
      end if;
      v_due_date := app_private.add_months_clamped(v_due_date, v_revision.interval_months);
    end loop;
  elsif not exists (
    select 1 from public.maintenance_due_work due_work
    where due_work.maintenance_plan_id = p_maintenance_plan_id
      and due_work.maintenance_plan_revision_id = v_revision.id
  ) and v_revision.first_due_date <= p_through_date then
    v_due_id := gen_random_uuid();
    perform set_config('app.maintenance_write', 'true', true);
    insert into public.maintenance_due_work (
      id, organization_id, maintenance_plan_id, maintenance_plan_revision_id,
      original_due_date, due_date, window_start_date, window_end_date,
      created_by, updated_by
    ) values (
      v_due_id, p_organization_id, p_maintenance_plan_id, v_revision.id,
      v_revision.first_due_date, v_revision.first_due_date,
      v_revision.first_due_date - v_revision.due_window_before_days,
      v_revision.first_due_date + v_revision.due_window_after_days,
      p_actor_id, p_actor_id
    );
    perform set_config('app.maintenance_write', 'false', true);
    perform app_private.record_maintenance_due_event(
      p_organization_id, v_due_id, 'generated', p_actor_id, null,
      'due_generated', v_due_id, jsonb_build_object('dueDate', v_revision.first_due_date),
      null, app_private.maintenance_due_snapshot(v_due_id, p_organization_id)
    );
  end if;

  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_plans plan set generation_through_date = greatest(
      coalesce(plan.generation_through_date, p_through_date), p_through_date
    ), version = plan.version + 1, updated_by = p_actor_id, updated_at = now()
  where plan.id = p_maintenance_plan_id and plan.organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_plan_event(
    p_organization_id, p_maintenance_plan_id, 'horizon_extended', p_actor_id, null,
    'plan_generate', p_idempotency_key, v_payload, v_before_snapshot,
    app_private.maintenance_plan_snapshot(p_maintenance_plan_id, p_organization_id)
  );
  return query select due_work.* from public.maintenance_due_work due_work
  where due_work.maintenance_plan_id = p_maintenance_plan_id
    and due_work.organization_id = p_organization_id and due_work.due_date <= p_through_date
  order by due_work.due_date, due_work.id;
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

create or replace function public.set_maintenance_due_exception(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_to_status public.maintenance_due_status,
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
  v_payload jsonb := jsonb_build_object('toStatus', p_to_status);
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_exception', p_idempotency_key);
  if p_to_status not in ('skipped', 'cancelled', 'superseded') then raise exception 'maintenance_due_exception_status_invalid'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  select * into v_existing from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id and event.request_operation = 'due_exception'
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
  if v_before.status not in ('open', 'visit_created') then raise exception 'maintenance_due_exception_not_allowed'; end if;
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_due_work due_work set status = p_to_status,
    exception_reason = btrim(p_reason), version = due_work.version + 1,
    updated_by = p_actor_id, updated_at = now()
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, p_to_status::text::public.maintenance_due_event_type,
    p_actor_id, p_reason, 'due_exception', p_idempotency_key, v_payload,
    to_jsonb(v_before), app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_after;
end;
$$;

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
  v_evidence_id uuid;
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
  if cardinality(p_work_artifact_revision_ids) not between 1 and 50 then
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
  select * into strict v_revision from public.maintenance_plan_revisions revision
  where revision.id = v_before.maintenance_plan_revision_id and revision.organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'true', true);
  foreach v_evidence_id in array p_work_artifact_revision_ids loop
    insert into public.maintenance_due_evidence_links (
      organization_id, maintenance_due_work_id, work_artifact_revision_id, created_by
    ) values (p_organization_id, p_maintenance_due_work_id, v_evidence_id, p_actor_id);
  end loop;
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

create or replace function public.link_maintenance_service_case(
  p_organization_id uuid,
  p_maintenance_plan_id uuid,
  p_maintenance_due_work_id uuid,
  p_service_case_id uuid,
  p_expected_due_version bigint,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_service_case_links
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_due public.maintenance_due_work%rowtype;
  v_link public.maintenance_service_case_links%rowtype;
  v_payload jsonb := jsonb_build_object('serviceCaseId', p_service_case_id);
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_service_case_link', p_idempotency_key);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'maintenance_reason_required'; end if;
  select * into v_existing from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'due_service_case_link'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    select * into strict v_link from public.maintenance_service_case_links link
    where link.organization_id = p_organization_id
      and link.maintenance_plan_id = p_maintenance_plan_id
      and link.maintenance_due_work_id = p_maintenance_due_work_id
      and link.service_case_id = p_service_case_id;
    return v_link;
  end if;
  select * into v_due from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id for update;
  if not found or v_due.maintenance_plan_id <> p_maintenance_plan_id then raise exception 'maintenance_due_not_found'; end if;
  if v_due.version <> p_expected_due_version then raise exception 'maintenance_stale_version'; end if;
  perform set_config('app.maintenance_write', 'true', true);
  insert into public.maintenance_service_case_links (
    organization_id, maintenance_plan_id, maintenance_due_work_id,
    service_case_id, reason, created_by
  ) values (
    p_organization_id, p_maintenance_plan_id, p_maintenance_due_work_id,
    p_service_case_id, btrim(p_reason), p_actor_id
  ) returning * into v_link;
  update public.maintenance_due_work due_work set version = due_work.version + 1,
    updated_by = p_actor_id, updated_at = now()
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id;
  perform set_config('app.maintenance_write', 'false', true);
  perform app_private.record_maintenance_due_event(
    p_organization_id, p_maintenance_due_work_id, 'service_case_linked', p_actor_id,
    p_reason, 'due_service_case_link', p_idempotency_key, v_payload,
    to_jsonb(v_due), app_private.maintenance_due_snapshot(p_maintenance_due_work_id, p_organization_id)
  );
  return v_link;
end;
$$;

revoke all on function app_private.assert_maintenance_manager(uuid, uuid),
  app_private.lock_maintenance_operation(uuid, text, uuid),
  app_private.next_maintenance_number(uuid, text),
  app_private.add_months_clamped(date, integer),
  app_private.maintenance_coverage_snapshot(uuid, uuid),
  app_private.maintenance_plan_snapshot(uuid, uuid),
  app_private.maintenance_due_snapshot(uuid, uuid),
  app_private.record_maintenance_coverage_event(uuid, uuid, public.maintenance_coverage_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.record_maintenance_plan_event(uuid, uuid, public.maintenance_plan_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.record_maintenance_due_event(uuid, uuid, public.maintenance_due_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.assert_maintenance_equipment_set(uuid, uuid, uuid, uuid, jsonb, text),
  app_private.insert_maintenance_revision_equipment(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function app_private.assert_maintenance_manager(uuid, uuid),
  app_private.lock_maintenance_operation(uuid, text, uuid),
  app_private.next_maintenance_number(uuid, text),
  app_private.add_months_clamped(date, integer),
  app_private.maintenance_coverage_snapshot(uuid, uuid),
  app_private.maintenance_plan_snapshot(uuid, uuid),
  app_private.maintenance_due_snapshot(uuid, uuid),
  app_private.record_maintenance_coverage_event(uuid, uuid, public.maintenance_coverage_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.record_maintenance_plan_event(uuid, uuid, public.maintenance_plan_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.record_maintenance_due_event(uuid, uuid, public.maintenance_due_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app_private.assert_maintenance_equipment_set(uuid, uuid, uuid, uuid, jsonb, text),
  app_private.insert_maintenance_revision_equipment(uuid, uuid, uuid, jsonb)
to service_role;

revoke all on function public.create_maintenance_coverage(uuid, uuid, jsonb, uuid, uuid),
  public.update_maintenance_coverage(uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.create_maintenance_plan(uuid, uuid, uuid, jsonb, uuid, uuid),
  public.revise_maintenance_plan(uuid, uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.transition_maintenance_plan(uuid, uuid, bigint, public.maintenance_plan_status, text, uuid, uuid),
  public.set_maintenance_plan_archived(uuid, uuid, bigint, boolean, text, uuid, uuid),
  public.generate_maintenance_due_work(uuid, uuid, bigint, date, uuid, uuid),
  public.link_maintenance_due_visit(uuid, uuid[], uuid, uuid, bigint[], text, uuid, uuid),
  public.set_maintenance_due_exception(uuid, uuid, bigint, public.maintenance_due_status, text, uuid, uuid),
  public.complete_maintenance_due_work(uuid, uuid, bigint, public.maintenance_scope_outcome, date, uuid[], text, uuid, uuid),
  public.link_maintenance_service_case(uuid, uuid, uuid, uuid, bigint, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.create_maintenance_coverage(uuid, uuid, jsonb, uuid, uuid),
  public.update_maintenance_coverage(uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.create_maintenance_plan(uuid, uuid, uuid, jsonb, uuid, uuid),
  public.revise_maintenance_plan(uuid, uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.transition_maintenance_plan(uuid, uuid, bigint, public.maintenance_plan_status, text, uuid, uuid),
  public.set_maintenance_plan_archived(uuid, uuid, bigint, boolean, text, uuid, uuid),
  public.generate_maintenance_due_work(uuid, uuid, bigint, date, uuid, uuid),
  public.link_maintenance_due_visit(uuid, uuid[], uuid, uuid, bigint[], text, uuid, uuid),
  public.set_maintenance_due_exception(uuid, uuid, bigint, public.maintenance_due_status, text, uuid, uuid),
  public.complete_maintenance_due_work(uuid, uuid, bigint, public.maintenance_scope_outcome, date, uuid[], text, uuid, uuid),
  public.link_maintenance_service_case(uuid, uuid, uuid, uuid, bigint, text, uuid, uuid)
to service_role;
