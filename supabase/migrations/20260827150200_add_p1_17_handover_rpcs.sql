create or replace function app_private.validate_work_handover_sources(
  p_package_id uuid
)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare
  v_package public.work_handover_packages%rowtype;
  v_invalid_count integer;
begin
  select * into v_package
  from public.work_handover_packages package
  where package.id = p_package_id;
  if not found then raise exception 'work_handover_package_not_found'; end if;

  select count(*) into v_invalid_count
  from public.work_handover_draft_items item
  where item.package_id = p_package_id and (
    (item.source_kind = 'work_artifact_revision' and not exists (
      select 1
      from public.work_artifact_revisions revision
      join public.work_artifacts artifact
        on artifact.id = revision.artifact_id
       and artifact.organization_id = revision.organization_id
      where revision.id = item.work_artifact_revision_id
        and revision.organization_id = v_package.organization_id
        and revision.visibility = 'customer_facing'
        and artifact.current_revision_id = revision.id
        and artifact.status = 'approved'
        and ((v_package.job_id is not null and artifact.job_id = v_package.job_id)
          or (v_package.project_id is not null and artifact.project_id = v_package.project_id))
    ))
    or (item.source_kind = 'document_version' and not exists (
      select 1
      from public.documents document
      join public.document_links link on link.document_id = document.id
      where document.id = item.document_id
        and document.organization_id = v_package.organization_id
        and document.deleted_at is null
        and ((v_package.job_id is not null and link.job_id = v_package.job_id)
          or (v_package.project_id is not null and link.project_id = v_package.project_id))
        and (
          (document.current_version_number = item.document_version_number
            and document.storage_path = item.document_storage_path)
          or exists (
            select 1 from public.document_versions version
            where version.document_id = document.id
              and version.organization_id = document.organization_id
              and version.version_number = item.document_version_number
              and version.storage_path = item.document_storage_path
          )
        )
    ))
    or (item.source_kind = 'child_handover_release' and not exists (
      select 1
      from public.work_handover_releases child_release
      join public.work_handover_packages child_package
        on child_package.id = child_release.package_id
       and child_package.organization_id = child_release.organization_id
      join public.jobs child_job on child_job.id = child_package.job_id
      where child_release.id = item.child_handover_release_id
        and child_release.organization_id = v_package.organization_id
        and v_package.project_id is not null
        and child_job.project_id = v_package.project_id
        and child_package.state = 'released'
        and child_package.current_release_id = child_release.id
    ))
  );
  if v_invalid_count > 0 then raise exception 'work_handover_source_stale'; end if;
end;
$$;

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
declare
  v_package public.work_handover_packages%rowtype;
  v_existing_release public.work_handover_releases%rowtype;
  v_snapshot jsonb;
  v_fingerprint text;
  v_overrideable jsonb := '[]'::jsonb;
  v_release_number integer;
  v_readiness public.work_handover_commercial_readiness_state;
  v_transition record;
  v_reason text := nullif(btrim(coalesce(p_handover_reason, '')), '');
  v_override_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_item_count integer;
begin
  select * into v_existing_release from public.work_handover_releases release
  where release.organization_id = p_organization_id and release.request_id = p_request_id;
  if found then
    if v_existing_release.package_id <> p_package_id
      or v_existing_release.id <> p_release_id
      or v_existing_release.content_hash <> p_content_hash
    then raise exception 'work_handover_idempotency_conflict'; end if;
    return jsonb_build_object('packageId', p_package_id,
      'releaseId', v_existing_release.id,
      'releaseNumber', v_existing_release.release_number,
      'documentId', v_existing_release.package_document_id,
      'commercialReadiness', v_existing_release.commercial_readiness,
      'duplicate', true);
  end if;

  if p_expected_package_version < 1 or p_expected_execution_version < 0
    or v_reason is null or length(v_reason) not between 3 and 1000
    or p_expected_gate_fingerprint !~ '^[0-9a-f]{64}$'
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(p_renderer_version)) not between 1 and 100
    or length(btrim(p_file_name)) not between 1 and 255
    or p_size_bytes <= 0
    or p_storage_path <> (p_organization_id::text || '/work-handover-packages/'
      || p_release_id::text || '/' || p_renderer_version || '-' || p_content_hash || '.html')
    or jsonb_typeof(p_target_snapshot) <> 'object'
    or jsonb_typeof(p_time_summary) <> 'object'
    or jsonb_typeof(p_material_summary) <> 'object'
    or jsonb_typeof(p_responsibility_snapshot) <> 'object'
    or jsonb_typeof(p_unassessed_facts) <> 'array'
    or jsonb_typeof(p_item_payloads) <> 'array'
  then raise exception 'work_handover_invalid_input'; end if;

  select * into v_package from public.work_handover_packages package
  where package.id = p_package_id and package.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_handover_package_not_found'; end if;
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if v_package.version <> p_expected_package_version
  then raise exception 'work_handover_stale_version'; end if;
  if v_package.state not in ('draft', 'reopened')
  then raise exception 'work_handover_release_state_invalid'; end if;

  perform app_private.validate_work_handover_sources(p_package_id);
  select count(*) into v_item_count from public.work_handover_draft_items item
  where item.package_id = p_package_id;
  if v_item_count = 0 then raise exception 'work_handover_package_empty'; end if;
  if v_item_count <> jsonb_array_length(p_item_payloads)
    or exists (
      select 1 from public.work_handover_draft_items item
      where item.package_id = p_package_id and not exists (
        select 1 from jsonb_to_recordset(p_item_payloads) payload(
          draft_item_id uuid, customer_payload jsonb
        ) where payload.draft_item_id = item.id
          and jsonb_typeof(payload.customer_payload) = 'object'
      )
    )
  then raise exception 'work_handover_payload_mismatch'; end if;

  v_snapshot := app_private.build_work_gate_snapshot(
    p_organization_id, v_package.job_id, v_package.project_id
  );
  v_fingerprint := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');
  if v_fingerprint <> p_expected_gate_fingerprint
  then raise exception 'work_handover_gate_stale'; end if;
  if (v_snapshot->>'activeJobClocks')::integer > 0
  then raise exception 'work_handover_active_clock'; end if;

  if (v_snapshot->>'incompleteRequiredInstructions')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('incomplete_required_instructions'); end if;
  if (v_snapshot->>'reopenedInstructionPredecessors')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('reopened_instruction_predecessors'); end if;
  if (v_snapshot->>'incompleteInstructionEvidence')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('incomplete_instruction_evidence'); end if;
  if (v_snapshot->>'openBlockers')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('open_blockers'); end if;
  if (v_snapshot->>'openCompletionDependencies')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('open_completion_dependencies'); end if;
  if (v_snapshot->>'incompleteProjectChildren')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('incomplete_project_children'); end if;
  if (v_snapshot->>'incompleteChildHandovers')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('incomplete_child_handovers'); end if;
  if (v_snapshot->>'openDefects')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('open_defects'); end if;
  if (v_snapshot->>'pendingFormalApprovals')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('pending_formal_approvals'); end if;
  if (v_snapshot->>'requiredCustomerDecisions')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('required_customer_decisions'); end if;
  if (v_snapshot->>'requiredSignatures')::integer > 0
    then v_overrideable := v_overrideable || jsonb_build_array('required_signatures'); end if;

  if jsonb_array_length(v_overrideable) > 0 and not p_override_gates
  then raise exception 'work_handover_review_blocked'; end if;
  if jsonb_array_length(v_overrideable) > 0
    and (v_override_reason is null or length(v_override_reason) not between 3 and 1000)
  then raise exception 'work_handover_override_reason_required'; end if;
  if jsonb_array_length(v_overrideable) = 0 and p_override_gates
  then raise exception 'work_handover_override_not_needed'; end if;
  v_readiness := case when jsonb_array_length(v_overrideable) > 0
    then 'ready_with_exceptions'::public.work_handover_commercial_readiness_state
    else 'ready_for_commercial_review'::public.work_handover_commercial_readiness_state end;

  v_release_number := coalesce((select max(release.release_number) + 1
    from public.work_handover_releases release where release.package_id = p_package_id), 1);
  perform set_config('app.work_handover_write', 'true', true);
  insert into public.documents (
    id, organization_id, folder_id, storage_bucket, storage_path,
    original_file_name, display_name, category, mime_type, size_bytes,
    uploaded_by, metadata
  ) values (
    p_document_id, p_organization_id, null, 'organization-documents', p_storage_path,
    p_file_name, p_file_name, 'report', 'text/html; charset=utf-8', p_size_bytes,
    p_actor_id, jsonb_build_object('handoverPackageId', p_package_id,
      'handoverReleaseId', p_release_id, 'rendererVersion', p_renderer_version,
      'contentHash', p_content_hash)
  );
  insert into public.document_links (
    id, organization_id, document_id, job_id, project_id, created_by
  ) values (
    p_document_link_id, p_organization_id, p_document_id,
    v_package.job_id, v_package.project_id, p_actor_id
  );
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object(
      'source', 'work_handover_release',
      'handoverPackageId', p_package_id,
      'handoverReleaseId', p_release_id,
      'storagePath', p_storage_path,
      'rendererVersion', p_renderer_version,
      'contentHash', p_content_hash
    )
  );

  insert into public.work_handover_releases (
    id, organization_id, package_id, release_number, previous_release_id,
    request_id, target_snapshot, gate_snapshot, gate_fingerprint,
    time_summary, material_summary, responsibility_snapshot,
    overridden_gates, override_reason, commercial_readiness,
    unassessed_facts, renderer_version, content_hash, package_document_id,
    reviewed_by
  ) values (
    p_release_id, p_organization_id, p_package_id, v_release_number,
    v_package.current_release_id, p_request_id, p_target_snapshot, v_snapshot,
    v_fingerprint, p_time_summary, p_material_summary, p_responsibility_snapshot,
    v_overrideable, case when jsonb_array_length(v_overrideable) > 0
      then v_override_reason else null end,
    v_readiness, p_unassessed_facts, p_renderer_version, p_content_hash,
    p_document_id, p_actor_id
  );

  insert into public.work_handover_release_items (
    id, organization_id, release_id, source_kind,
    work_artifact_revision_id, document_id, document_version_number,
    document_storage_path, child_handover_release_id, customer_label,
    customer_payload, sort_order
  )
  select gen_random_uuid(), item.organization_id, p_release_id, item.source_kind,
    item.work_artifact_revision_id, item.document_id, item.document_version_number,
    item.document_storage_path, item.child_handover_release_id,
    item.customer_label, payload.customer_payload, item.sort_order
  from public.work_handover_draft_items item
  join jsonb_to_recordset(p_item_payloads) payload(
    draft_item_id uuid, customer_payload jsonb
  ) on payload.draft_item_id = item.id
  where item.package_id = p_package_id;

  update public.work_handover_packages set state = 'released',
    version = version + 1, current_release_id = p_release_id,
    updated_by = p_actor_id, updated_at = now()
  where id = p_package_id;

  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, from_state, to_state,
    release_id, previous_release_id, event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'release_reviewed',
    v_package.state, 'released', p_release_id, v_package.current_release_id,
    jsonb_build_object('responsibility', p_responsibility_snapshot,
      'commercialReadiness', v_readiness), p_actor_id
  );
  if jsonb_array_length(v_overrideable) > 0 then
    insert into public.work_handover_events (
      id, organization_id, package_id, event_type, from_state, to_state,
      release_id, previous_release_id, reason, event_payload, created_by
    ) values (
      gen_random_uuid(), p_organization_id, p_package_id, 'override_applied',
      v_package.state, 'released', p_release_id, v_package.current_release_id,
      v_override_reason, jsonb_build_object('gates', v_overrideable,
        'gateFingerprint', v_fingerprint), p_actor_id
    );
  end if;
  if v_package.current_release_id is not null then
    insert into public.work_handover_events (
      id, organization_id, package_id, event_type, from_state, to_state,
      release_id, previous_release_id, event_payload, created_by
    ) values (
      gen_random_uuid(), p_organization_id, p_package_id, 'successor_created',
      v_package.state, 'released', p_release_id, v_package.current_release_id,
      jsonb_build_object('releaseNumber', v_release_number), p_actor_id
    );
  end if;

  perform set_config('app.work_transition_origin', 'p1_17_release', true);
  select * into v_transition from public.transition_work_execution(
    p_organization_id, p_actor_id,
    case when v_package.job_id is not null then 'job' else 'project' end,
    coalesce(v_package.job_id, v_package.project_id),
    p_expected_execution_version, 'handed_over', v_reason,
    jsonb_array_length(v_overrideable) > 0
  );
  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, request_id,
    request_fingerprint, from_state, to_state, release_id,
    previous_release_id, reason, event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'released', p_request_id,
    p_content_hash, v_package.state, 'released', p_release_id,
    v_package.current_release_id, v_reason,
    jsonb_build_object('releaseNumber', v_release_number,
      'executionEventId', v_transition.event_id,
      'executionVersion', v_transition.execution_version), p_actor_id
  );
  return jsonb_build_object('packageId', p_package_id, 'packageVersion',
    p_expected_package_version + 1, 'releaseId', p_release_id,
    'releaseNumber', v_release_number, 'documentId', p_document_id,
    'executionVersion', v_transition.execution_version,
    'commercialReadiness', v_readiness, 'duplicate', false);
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
  v_existing public.work_handover_events%rowtype;
  v_fingerprint text;
  v_transition record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) not between 3 and 1000
  then raise exception 'work_handover_reason_required'; end if;
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'packageId', p_package_id, 'packageVersion', p_expected_package_version,
    'executionVersion', p_expected_execution_version, 'reason', v_reason
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.work_handover_events event
  where event.organization_id = p_organization_id and event.request_id = p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint
    then raise exception 'work_handover_idempotency_conflict'; end if;
    return v_existing.event_payload || jsonb_build_object('duplicate', true);
  end if;
  select * into v_package from public.work_handover_packages package
  where package.id = p_package_id and package.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_handover_package_not_found'; end if;
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if v_package.version <> p_expected_package_version
    or v_package.state <> 'released' or v_package.current_release_id is null
  then raise exception 'work_handover_stale_version'; end if;
  perform set_config('app.work_transition_origin', 'p1_17_withdrawal', true);
  select * into v_transition from public.transition_work_execution(
    p_organization_id, p_actor_id,
    case when v_package.job_id is not null then 'job' else 'project' end,
    coalesce(v_package.job_id, v_package.project_id),
    p_expected_execution_version, 'execution_complete', v_reason, false
  );
  perform set_config('app.work_handover_write', 'true', true);
  update public.work_handover_packages set state = 'reopened', version = version + 1,
    updated_by = p_actor_id, updated_at = now() where id = p_package_id;
  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, request_id,
    request_fingerprint, from_state, to_state, release_id, reason,
    event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'handover_withdrawn',
    p_request_id, v_fingerprint, 'released', 'reopened',
    v_package.current_release_id, v_reason,
    jsonb_build_object('packageId', p_package_id,
      'packageVersion', p_expected_package_version + 1,
      'executionVersion', v_transition.execution_version,
      'executionEventId', v_transition.event_id, 'duplicate', false), p_actor_id
  );
  return jsonb_build_object('packageId', p_package_id,
    'packageVersion', p_expected_package_version + 1,
    'executionVersion', v_transition.execution_version,
    'executionEventId', v_transition.event_id, 'duplicate', false);
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
  v_existing public.work_handover_events%rowtype;
  v_fingerprint text;
  v_transition record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) not between 3 and 1000
  then raise exception 'work_handover_reason_required'; end if;
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'packageId', p_package_id, 'packageVersion', p_expected_package_version,
    'executionVersion', p_expected_execution_version, 'reason', v_reason
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.work_handover_events event
  where event.organization_id = p_organization_id and event.request_id = p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint
    then raise exception 'work_handover_idempotency_conflict'; end if;
    return v_existing.event_payload || jsonb_build_object('duplicate', true);
  end if;
  select * into v_package from public.work_handover_packages package
  where package.id = p_package_id and package.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_handover_package_not_found'; end if;
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if v_package.version <> p_expected_package_version
    or v_package.state not in ('draft', 'reopened')
  then raise exception 'work_handover_stale_version'; end if;
  perform set_config('app.work_transition_origin', 'p1_17_correction', true);
  select * into v_transition from public.transition_work_execution(
    p_organization_id, p_actor_id,
    case when v_package.job_id is not null then 'job' else 'project' end,
    coalesce(v_package.job_id, v_package.project_id),
    p_expected_execution_version, 'in_progress', v_reason, false
  );
  perform set_config('app.work_handover_write', 'true', true);
  update public.work_handover_packages set state = 'reopened', version = version + 1,
    updated_by = p_actor_id, updated_at = now() where id = p_package_id;
  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, request_id,
    request_fingerprint, from_state, to_state, release_id, reason,
    event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'review_returned',
    p_request_id, v_fingerprint, v_package.state, 'reopened',
    v_package.current_release_id, v_reason,
    jsonb_build_object('packageId', p_package_id,
      'packageVersion', p_expected_package_version + 1,
      'executionVersion', v_transition.execution_version,
      'executionEventId', v_transition.event_id, 'duplicate', false), p_actor_id
  );
  insert into public.work_handover_events (
    id, organization_id, package_id, event_type, from_state, to_state,
    release_id, reason, event_payload, created_by
  ) values (
    gen_random_uuid(), p_organization_id, p_package_id, 'execution_reopened',
    v_package.state, 'reopened', v_package.current_release_id, v_reason,
    jsonb_build_object('executionEventId', v_transition.event_id), p_actor_id
  );
  return jsonb_build_object('packageId', p_package_id,
    'packageVersion', p_expected_package_version + 1,
    'executionVersion', v_transition.execution_version,
    'executionEventId', v_transition.event_id, 'duplicate', false);
end;
$$;

revoke all on function app_private.validate_work_handover_sources(uuid)
from public, anon, authenticated;
grant execute on function app_private.validate_work_handover_sources(uuid)
to service_role;

revoke all on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) to service_role;

revoke all on function public.release_work_handover(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) from public, anon, authenticated;
grant execute on function public.release_work_handover(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) to service_role;

revoke all on function public.withdraw_work_handover(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.withdraw_work_handover(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) to service_role;

revoke all on function public.return_work_handover_for_correction(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.return_work_handover_for_correction(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) to service_role;
