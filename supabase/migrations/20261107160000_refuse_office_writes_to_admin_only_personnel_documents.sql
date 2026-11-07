-- A personnel document of an Admin-only access class changes only through an Admin.
--
-- admin_restricted and health_evidence documents are an Admin's alone; a
-- release lets the affected employee read a version, never change it.
-- app_private.lock_active_document, which rename, category change, move, copy
-- and trash call, and finalize_document_version_upload refuse such a document
-- with 'not_authorized' unless the actor passes app_private.p1_24_is_admin,
-- the rule restore_document applies since
-- 20261029110000_restrict_restore_of_admin_only_personnel_documents.sql.
-- getManageableDocument in lib/documents/access.ts applies the same rule
-- before every call. Prevention: Tier 2, supabase/tests/document_writes.sql.
--
-- The signatures, the other refusals and the grants stay as before.

create or replace function app_private.lock_active_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns public.documents
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_document public.documents;
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is null
  for update;
  if not found then
    raise exception 'document_not_found';
  end if;
  if exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = p_document_id and protected.organization_id = p_organization_id
      and protected.access_class <> 'personnel_standard'
  ) and not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  return v_document;
end;
$$;

-- Refusals: not_authorized, document_not_found, versioning_not_supported,
-- version_conflict.
create or replace function public.finalize_document_version_upload(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_version_number integer,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_updated public.documents;
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is null
  for update;
  if not found then
    raise exception 'document_not_found';
  end if;
  if exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = p_document_id and protected.organization_id = p_organization_id
      and protected.access_class <> 'personnel_standard'
  ) and not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if v_document.category not in ('contract', 'invoice', 'offer', 'report') then
    raise exception 'versioning_not_supported';
  end if;
  if v_document.current_version_number <> p_expected_version_number then
    raise exception 'version_conflict';
  end if;

  insert into public.document_versions (
    organization_id, document_id, version_number, storage_bucket, storage_path,
    original_file_name, mime_type, size_bytes, uploaded_by
  ) values (
    p_organization_id, p_document_id, v_document.current_version_number, v_document.storage_bucket,
    v_document.storage_path, v_document.original_file_name, v_document.mime_type,
    v_document.size_bytes, v_document.uploaded_by
  );
  update public.documents document set
    current_version_number = v_document.current_version_number + 1,
    storage_path = p_storage_path,
    original_file_name = p_original_file_name,
    mime_type = p_mime_type,
    size_bytes = p_size_bytes,
    uploaded_by = p_actor_id
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;

  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'version_uploaded',
    jsonb_build_object(
      'previousVersionNumber', v_document.current_version_number,
      'currentVersionNumber', v_updated.current_version_number,
      'storagePath', v_updated.storage_path, 'originalFileName', v_updated.original_file_name,
      'mimeType', v_updated.mime_type, 'sizeBytes', v_updated.size_bytes
    )
  );
  return v_updated;
end;
$$;
