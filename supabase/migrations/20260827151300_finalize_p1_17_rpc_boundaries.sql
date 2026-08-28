-- P1-17: finalize RPC validation, gate shape enforcement, and probe indexes.

create index if not exists document_links_p1_17_org_job_idx
  on public.document_links (organization_id, job_id)
  where job_id is not null;
create index if not exists document_links_p1_17_org_project_idx
  on public.document_links (organization_id, project_id)
  where project_id is not null;
create index if not exists planning_dispatches_p1_17_org_status_job_idx
  on public.planning_dispatches (organization_id, status, job_id)
  where job_id is not null;
create index if not exists time_entries_p1_17_org_job_status_idx
  on public.time_entries (organization_id, job_id, status)
  where job_id is not null;

create or replace function public.save_work_handover_draft(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_package_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 200
    or exists (
      select 1 from jsonb_array_elements(p_items) item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'id') is distinct from 'string'
        or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'source_kind') is distinct from 'string'
        or item->>'source_kind' not in (
          'work_artifact_revision', 'document_version', 'child_handover_release'
        )
        or jsonb_typeof(item->'customer_label') is distinct from 'string'
        or length(btrim(item->>'customer_label')) not between 1 and 200
        or jsonb_typeof(item->'sort_order') is distinct from 'number'
        or (item->>'sort_order') !~ '^[0-9]+$'
    )
    or (select count(*) <> count(distinct item->>'id')
          or count(*) <> count(distinct item->>'sort_order')
        from jsonb_array_elements(p_items) item)
  then raise exception 'work_handover_invalid_input'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.work_handover_draft_items existing
      on existing.id = (item->>'id')::uuid
    where existing.package_id <> p_package_id
  ) then raise exception 'work_handover_invalid_input'; end if;

  v_result := public.save_work_handover_draft_p1_17_inner(
    p_organization_id, p_actor_id, p_target_type, p_target_id, p_package_id,
    p_expected_version, p_request_id, p_items
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

create or replace function public.release_work_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_release_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_expected_gate_fingerprint text,
  p_handover_reason text,
  p_override_gates boolean,
  p_override_reason text,
  p_target_snapshot jsonb,
  p_time_summary jsonb,
  p_material_summary jsonb,
  p_responsibility_snapshot jsonb,
  p_unassessed_facts jsonb,
  p_item_payloads jsonb,
  p_document_id uuid,
  p_document_link_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if p_renderer_version is null
    or length(btrim(p_renderer_version)) not between 1 and 100
    or p_renderer_version !~ '^[A-Za-z0-9_-]+([.][A-Za-z0-9_-]+)*$'
  then raise exception 'work_handover_invalid_input'; end if;

  v_result := public.release_work_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_release_id, p_request_id,
    p_expected_package_version, p_expected_execution_version,
    p_expected_gate_fingerprint, p_handover_reason, p_override_gates,
    p_override_reason, p_target_snapshot, p_time_summary, p_material_summary,
    p_responsibility_snapshot, p_unassessed_facts, p_item_payloads,
    p_document_id, p_document_link_id, p_storage_path, p_file_name,
    p_size_bytes, p_renderer_version, p_content_hash
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

create or replace function public.withdraw_work_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_package public.work_handover_packages%rowtype;
  v_result jsonb;
begin
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if not exists (
    select 1 from public.work_handover_events event
    where event.organization_id = p_organization_id and event.request_id = p_request_id
  ) then
    select * into v_package from public.work_handover_packages package
    where package.organization_id = p_organization_id and package.id = p_package_id;
    if not found then raise exception 'work_handover_package_not_found'; end if;
    if v_package.version <> p_expected_package_version
    then raise exception 'work_handover_stale_version'; end if;
    if v_package.state <> 'released' or v_package.current_release_id is null
    then raise exception 'work_handover_release_state_invalid'; end if;
  end if;

  v_result := public.withdraw_work_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_request_id,
    p_expected_package_version, p_expected_execution_version, p_reason
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

create or replace function public.return_work_handover_for_correction(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_package public.work_handover_packages%rowtype;
  v_result jsonb;
begin
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if not exists (
    select 1 from public.work_handover_events event
    where event.organization_id = p_organization_id and event.request_id = p_request_id
  ) then
    select * into v_package from public.work_handover_packages package
    where package.organization_id = p_organization_id and package.id = p_package_id;
    if not found then raise exception 'work_handover_package_not_found'; end if;
    if v_package.version <> p_expected_package_version
    then raise exception 'work_handover_stale_version'; end if;
    if v_package.state not in ('draft', 'reopened')
    then raise exception 'work_handover_release_state_invalid'; end if;
  end if;

  v_result := public.return_work_handover_for_correction_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_request_id,
    p_expected_package_version, p_expected_execution_version, p_reason
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

alter function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
  rename to build_work_gate_snapshot_p1_17_shape_inner;

revoke all on function app_private.build_work_gate_snapshot_p1_17_shape_inner(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_active_clocks text;
begin
  v_snapshot := app_private.build_work_gate_snapshot_p1_17_shape_inner(
    p_organization_id, p_job_id, p_project_id
  );
  if v_snapshot is null
    or jsonb_typeof(v_snapshot->'activeJobClocks') is distinct from 'number'
  then raise exception 'work_handover_gate_snapshot_invalid'; end if;
  v_active_clocks := v_snapshot->>'activeJobClocks';
  if v_active_clocks !~ '^[0-9]+$'
  then raise exception 'work_handover_gate_snapshot_invalid'; end if;
  return v_snapshot;
end;
$$;

revoke all on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) to service_role;

create or replace function app_private.transition_work_execution_for_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text,
  p_override_gates boolean,
  p_origin text
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql security definer set search_path = ''
as $$
begin
  return query select * from app_private.transition_work_execution_for_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates, p_origin
  );
  perform set_config('app.work_execution_write', '', true);
exception when others then
  perform set_config('app.work_execution_write', '', true);
  raise;
end;
$$;
