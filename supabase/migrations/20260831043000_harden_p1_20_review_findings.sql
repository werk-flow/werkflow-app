-- Preserve applied P1-20 history while tightening review findings before PROD.

drop policy "Managers or assigned employees can view maintenance due work"
  on public.maintenance_due_work;
create policy "Managers or assigned employees can view maintenance due work"
on public.maintenance_due_work
for select to authenticated using (
  app_private.maintenance_actor_is_manager(organization_id, (select auth.uid()))
  or exists (
    select 1
    from public.job_assignments assignment
    where assignment.job_id = maintenance_due_work.job_id
      and assignment.organization_id = maintenance_due_work.organization_id
      and assignment.user_id = (select auth.uid())
  )
);

-- The accepted P1-20 flow links reactive context to an exact due item or its
-- visit. Keeping this column nullable promised an unsupported plan-only path.
do $$
begin
  if exists (
    select 1
    from public.maintenance_service_case_links
    where maintenance_due_work_id is null
  ) then
    raise exception 'maintenance_service_case_due_required';
  end if;
end;
$$;
alter table public.maintenance_service_case_links
  alter column maintenance_due_work_id set not null;

-- These composite FK indexes duplicate existing indexes whose leading column
-- already covers the referenced-row lookup.
drop index if exists public.maintenance_coverage_events_root_org_fk_idx;
drop index if exists public.maintenance_due_work_plan_org_fk_idx;
drop index if exists public.maintenance_due_work_events_root_org_fk_idx;
drop index if exists public.maintenance_plan_events_root_org_fk_idx;
drop index if exists public.maintenance_plan_revision_equipment_revision_org_fk_idx;
drop index if exists public.maintenance_plan_revisions_plan_org_fk_idx;

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
  v_today date := (timezone('Europe/Berlin', now()))::date;
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
  if p_through_date < v_today or p_through_date > v_today + interval '18 months' then
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

create or replace function app_private.record_maintenance_coverage_document_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_coverage public.maintenance_coverages%rowtype;
  v_document public.documents%rowtype;
  v_before_snapshot jsonb;
  v_payload jsonb;
  v_previous_maintenance_write text := current_setting('app.maintenance_write', true);
begin
  if new.maintenance_coverage_id is null then return new; end if;
  select * into strict v_coverage from public.maintenance_coverages coverage
  where coverage.id = new.maintenance_coverage_id
    and coverage.organization_id = new.organization_id for update;
  select * into strict v_document from public.documents document
  where document.id = new.document_id and document.organization_id = new.organization_id;
  v_before_snapshot := app_private.maintenance_coverage_snapshot(v_coverage.id, new.organization_id);
  v_payload := jsonb_build_object(
    'documentLinkId', new.id,
    'documentId', new.document_id,
    'documentVersionNumber', v_document.current_version_number,
    'documentStoragePath', v_document.storage_path
  );
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_coverages set
    version = version + 1, updated_by = new.created_by, updated_at = now()
  where id = new.maintenance_coverage_id and organization_id = new.organization_id;
  perform set_config(
    'app.maintenance_write',
    coalesce(nullif(v_previous_maintenance_write, ''), 'false'),
    true
  );
  perform app_private.record_maintenance_coverage_event(
    new.organization_id, new.maintenance_coverage_id, 'document_linked', new.created_by,
    'Dokument verknüpft', 'document_link_insert', new.id, v_payload,
    v_before_snapshot,
    app_private.maintenance_coverage_snapshot(new.maintenance_coverage_id, new.organization_id)
  );
  return new;
end;
$$;
