-- Owner decision: an internal revision of an Arbeitsnachweis is never
-- exported. An export becomes a report document of the job or project, which
-- every reader of that target opens, so it carries only a customer-facing
-- revision. Both export functions refuse an internal one with
-- work_artifact_export_requires_customer_visibility, before they write
-- anything. The rest of both functions is unchanged from
-- 20261004140200_export_work_artifacts_atomically.sql; create or replace keeps
-- their grants.

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
  if exists (
    select 1 from public.work_artifact_revisions revision
    where revision.id = p_revision_id and revision.artifact_id = p_artifact_id
      and revision.visibility = 'internal_only'
  ) then raise exception 'work_artifact_export_requires_customer_visibility'; end if;
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
-- id. Refusals: work_artifact_not_found, work_artifact_not_authorized,
-- work_artifact_export_requires_customer_visibility and every refusal of
-- finalize_work_artifact_export.
create or replace function public.export_work_artifact(
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
  -- Refused before the duplicate check too, so no earlier export of an
  -- internal revision is handed out again.
  if exists (
    select 1 from public.work_artifact_revisions revision
    where revision.id = p_revision_id and revision.artifact_id = p_artifact_id
      and revision.visibility = 'internal_only'
  ) then raise exception 'work_artifact_export_requires_customer_visibility'; end if;
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
