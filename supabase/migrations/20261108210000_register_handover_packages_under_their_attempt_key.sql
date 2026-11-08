-- A handover release registers its package under the storage key of its own
-- attempt (werk-flow/werkflow-planning#299): `<release folder>/<attempt
-- id>-<renderer>-<content hash>.html`. Two attempts of one release, a
-- parallel one or a replay, never share a key, so an attempt the database
-- refuses removes only its own object (lib/work-handover/actions.ts). The
-- shared key `<release folder>/<renderer>-<content hash>.html` stays accepted
-- for the previous release's code, which still sends it until its build is
-- replaced.
--
-- Only the storage path check of the release function changes; its signature,
-- result and every other rule stay as they are. The public wrapper
-- release_work_handover calls this function unchanged.
--
-- Prevention: Tier 2, supabase/tests/work_execution_boundaries.sql and
-- lib/work-handover/release-storage.test.ts.

create or replace function public.release_work_handover_p1_17_inner(
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
  v_package_folder constant text := p_organization_id::text || '/work-handover-packages/'
    || p_release_id::text || '/';
  v_package_name constant text := p_renderer_version || '-' || p_content_hash || '.html';
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
    or not coalesce(
      p_storage_path = v_package_folder || v_package_name
      or (left(p_storage_path, length(v_package_folder)) = v_package_folder
        and substr(p_storage_path, length(v_package_folder) + 1)
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-'
        and substr(p_storage_path, length(v_package_folder) + 38) = v_package_name),
      false)
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
