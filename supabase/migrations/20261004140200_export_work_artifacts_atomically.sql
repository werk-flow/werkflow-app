-- A work-artifact export is one function call, and so one transaction.
-- exportWorkArtifact in lib/work-artifacts/actions.ts inserted the document,
-- its link, the artifact relation with its action and the audit event in four
-- consecutive statements and undid the earlier ones with unchecked deletes
-- when a later one failed. The action now stores the rendered object, calls
-- export_work_artifact and discards the object only when the call refused and
-- no committed document references the object.
--
-- Owner decision: a project-level document write and so the export of a
-- project artifact require a manager. The action refused a field worker on a
-- project artifact, but finalize_work_artifact_export admitted every assignee
-- through can_access_work_artifact_target. Both functions now refuse it too.

-- A field worker exports an artifact of an assigned job; a project artifact
-- needs a manager. It runs as the calling function's owner and no role
-- executes it directly.
create function app_private.assert_work_artifact_export_allowed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path to ''
as $$
begin
  if not app_private.can_access_work_artifact_target(p_organization_id, p_job_id, p_project_id, p_actor_id)
    or (p_project_id is not null and not app_private.is_work_artifact_manager(p_organization_id, p_actor_id))
  then
    raise exception 'work_artifact_not_authorized';
  end if;
end;
$$;

create or replace function public.finalize_work_artifact_export(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_document_id uuid,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_link_result jsonb;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id;
  if not found then raise exception 'work_artifact_not_found'; end if;
  perform app_private.assert_work_artifact_export_allowed(
    p_organization_id, p_actor_id, v_artifact.job_id, v_artifact.project_id
  );
  v_link_result := public.link_work_artifact_document(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_link_id,
    p_expected_version, p_document_id, 'rendered_export',
    'Deterministischer HTML-Export', p_renderer_version, p_content_hash
  );
  return public.record_work_artifact_action(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_action_id,
    (v_link_result->>'version')::bigint, 'exported', null, null,
    null, null, null
  );
end;
$$;

-- Registers the stored export object as a report document linked to the
-- artifact's job or project, relates it to the current revision, records the
-- export action and its audit event. An export of the same revision, renderer
-- and content that committed first is returned with duplicate = true and
-- nothing changes. Returns the artifact version and status and the document
-- id. Refusals: work_artifact_not_found, work_artifact_not_authorized and
-- every refusal of finalize_work_artifact_export.
create function public.export_work_artifact(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_document_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing_document_id uuid;
  v_result jsonb;
  v_metadata jsonb := jsonb_build_object(
    'artifactId', p_artifact_id, 'revisionId', p_revision_id,
    'rendererVersion', p_renderer_version, 'contentHash', p_content_hash
  );
begin
  -- The lock orders two exports of one artifact: the second sees the first one's relation.
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  perform app_private.assert_work_artifact_export_allowed(
    p_organization_id, p_actor_id, v_artifact.job_id, v_artifact.project_id
  );
  select relation.document_id into v_existing_document_id
  from public.work_artifact_revision_documents relation
  where relation.organization_id = p_organization_id and relation.revision_id = p_revision_id
    and relation.relation = 'rendered_export' and relation.renderer_version = p_renderer_version
    and relation.content_hash = p_content_hash
  limit 1;
  if found then
    return jsonb_build_object(
      'version', v_artifact.version, 'status', v_artifact.status,
      'documentId', v_existing_document_id, 'duplicate', true
    );
  end if;

  insert into public.documents (
    id, organization_id, folder_id, storage_path, original_file_name, display_name, category,
    mime_type, size_bytes, uploaded_by, metadata
  ) values (
    p_document_id, p_organization_id, null, p_storage_path, p_file_name, p_file_name, 'report',
    'text/html; charset=utf-8', p_size_bytes, p_actor_id, v_metadata
  );
  insert into public.document_links (organization_id, document_id, job_id, project_id, created_by)
  values (p_organization_id, p_document_id, v_artifact.job_id, v_artifact.project_id, p_actor_id);
  v_result := public.finalize_work_artifact_export(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_link_id, p_action_id,
    p_expected_version, p_document_id, p_renderer_version, p_content_hash
  );
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (p_organization_id, p_document_id, p_actor_id, 'uploaded', v_metadata);
  return v_result || jsonb_build_object('documentId', p_document_id, 'duplicate', false);
end;
$$;

revoke all on function app_private.assert_work_artifact_export_allowed(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_work_artifact_export(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.export_work_artifact(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_work_artifact_export(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text
) to service_role;
grant execute on function public.export_work_artifact(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, bigint, text, text
) to service_role;
