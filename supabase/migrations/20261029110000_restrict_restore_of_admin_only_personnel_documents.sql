-- Restoring a trashed personnel document ignored its access class.
--
-- restore_document let every document manager restore any trashed document.
-- A personnel document whose access class is not personnel_standard
-- (admin_restricted, health_evidence) is an Admin's alone, so an office
-- member could undo an Admin's trash of it. The function now refuses with
-- 'not_authorized' unless the actor passes app_private.p1_24_is_admin, the
-- rule app_private.can_access_personnel_document_version applies to reads.
-- getDeletedDocumentForManager in lib/documents/access.ts applies the same
-- rule before the call.
--
-- The signature, the other refusals and the grants stay as before.

create or replace function public.restore_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_folder_id uuid;
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is not null
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
  select folder.id into v_folder_id from public.document_folders folder
  where folder.id = v_document.folder_id and folder.organization_id = p_organization_id
    and folder.deleted_at is null;
  update public.documents document set
    folder_id = v_folder_id, display_name = p_display_name,
    deleted_at = null, deleted_by = null, delete_reason = null
  where document.id = p_document_id and document.organization_id = p_organization_id;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_folder_id, p_actor_id, 'restored',
    jsonb_build_object(
      'deletedAt', v_document.deleted_at, 'deletedBy', v_document.deleted_by,
      'deleteReason', v_document.delete_reason, 'originalFolderId', v_document.folder_id,
      'restoredToRoot', v_document.folder_id is not null and v_folder_id is null,
      'displayNameChanged', v_document.display_name <> btrim(p_display_name)
    )
  );
end;
$$;
