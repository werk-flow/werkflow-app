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
declare
  v_package public.work_handover_packages%rowtype;
  v_existing_event public.work_handover_events%rowtype;
  v_execution_state public.work_execution_state;
  v_request_fingerprint text;
  v_next_version bigint;
  v_package_exists boolean;
begin
  if p_target_type not in ('job', 'project') or p_expected_version < 0
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 200
  then raise exception 'work_handover_invalid_input'; end if;
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object('targetType', p_target_type, 'targetId', p_target_id,
      'packageId', p_package_id, 'expectedVersion', p_expected_version,
      'items', p_items)::text, 'sha256'
  ), 'hex');
  select * into v_existing_event from public.work_handover_events event
  where event.organization_id = p_organization_id and event.request_id = p_request_id;
  if found then
    if v_existing_event.request_fingerprint <> v_request_fingerprint
    then raise exception 'work_handover_idempotency_conflict'; end if;
    select * into v_package from public.work_handover_packages package
    where package.id = v_existing_event.package_id;
    return jsonb_build_object('packageId', v_package.id, 'version', v_package.version,
      'state', v_package.state, 'duplicate', true);
  end if;

  if p_target_type = 'job' then
    select coalesce(job.execution_state,
      app_private.resolve_legacy_job_execution_state(job.status))
    into v_execution_state from public.jobs job
    where job.id = p_target_id and job.organization_id = p_organization_id;
  else
    select coalesce(project.execution_state_override,
      app_private.resolve_legacy_project_execution_state(project.status_override))
    into v_execution_state from public.projects project
    where project.id = p_target_id and project.organization_id = p_organization_id;
  end if;
  if v_execution_state is null then raise exception 'work_handover_target_not_found'; end if;
  if v_execution_state <> 'execution_complete'
  then raise exception 'work_handover_execution_state_invalid'; end if;

  select * into v_package from public.work_handover_packages package
  where package.organization_id = p_organization_id
    and ((p_target_type = 'job' and package.job_id = p_target_id)
      or (p_target_type = 'project' and package.project_id = p_target_id))
  for update;
  v_package_exists := found;

  perform set_config('app.work_handover_write', 'true', true);
  if v_package_exists then
    if v_package.id <> p_package_id then raise exception 'work_handover_package_id_conflict'; end if;
    if v_package.version <> p_expected_version then raise exception 'work_handover_stale_version'; end if;
    if v_package.state not in ('draft', 'reopened')
    then raise exception 'work_handover_draft_state_invalid'; end if;
    v_next_version := v_package.version + 1;
    delete from public.work_handover_draft_items where package_id = v_package.id;
  else
    if p_expected_version <> 0 then raise exception 'work_handover_stale_version'; end if;
    insert into public.work_handover_packages (
      id, organization_id, job_id, project_id, state, version,
      created_by, updated_by
    ) values (
      p_package_id, p_organization_id,
      case when p_target_type = 'job' then p_target_id else null end,
      case when p_target_type = 'project' then p_target_id else null end,
      'draft', 1, p_actor_id, p_actor_id
    ) returning * into v_package;
    v_next_version := 1;
  end if;

  insert into public.work_handover_draft_items (
    id, organization_id, package_id, source_kind,
    work_artifact_revision_id, document_id, document_version_number,
    document_storage_path, child_handover_release_id, customer_label,
    sort_order, created_by
  )
  select item.id, p_organization_id, p_package_id,
    item.source_kind::public.work_handover_source_kind,
    item.work_artifact_revision_id, item.document_id,
    item.document_version_number, item.document_storage_path,
    item.child_handover_release_id, item.customer_label,
    item.sort_order, p_actor_id
  from jsonb_to_recordset(p_items) as item(
    id uuid, source_kind text, work_artifact_revision_id uuid,
    document_id uuid, document_version_number integer,
    document_storage_path text, child_handover_release_id uuid,
    customer_label text, sort_order integer
  );

  perform app_private.validate_work_handover_sources(p_package_id);
  if v_package.version <> v_next_version then
    update public.work_handover_packages set version = v_next_version,
      state = case when state = 'reopened'
        then 'reopened'::public.work_handover_package_state
        else 'draft'::public.work_handover_package_state end,
      updated_by = p_actor_id, updated_at = now()
    where id = p_package_id returning * into v_package;
  end if;

  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, request_id,
    request_fingerprint, from_state, to_state, event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'draft_saved',
    p_request_id, v_request_fingerprint, v_package.state, v_package.state,
    jsonb_build_object('itemCount', jsonb_array_length(p_items),
      'resultingVersion', v_package.version), p_actor_id
  );
  return jsonb_build_object('packageId', v_package.id, 'version', v_package.version,
    'state', v_package.state, 'duplicate', false);
end;
$$;

revoke all on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) to service_role;
