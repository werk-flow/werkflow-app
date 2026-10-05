-- A document change and its audit event are one function call, and so one
-- transaction. Rename, reclassification, move, copy, trash, restore and
-- permanent deletion in lib/documents/actions.ts wrote the row and then the
-- audit event in a second statement whose failure was only logged, so a
-- change could stand without its history. The division of work follows
-- 20261004140000_write_document_uploads_and_links_atomically.sql: the action
-- authorizes the caller and the document, each function repeats the manager
-- check and the state check under a row lock and raises the action failure
-- code of the first refusal.

-- The active document of the organization, locked for the change.
-- It runs as the calling function's owner and no role executes it directly.
create function app_private.lock_active_document(
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
  return v_document;
end;
$$;

-- Refusals: not_authorized, document_not_found; a taken name fails on the
-- unique name index.
create function public.rename_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_display_name text
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_active_document(p_actor_id, p_organization_id, p_document_id);
  v_updated public.documents;
begin
  update public.documents document set display_name = p_display_name
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'renamed',
    jsonb_build_object('from', v_document.display_name, 'to', v_updated.display_name)
  );
  return v_updated;
end;
$$;

-- Refusals: not_authorized, document_not_found; an unknown category fails on
-- the category check.
create function public.update_document_category(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_category text
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_active_document(p_actor_id, p_organization_id, p_document_id);
  v_updated public.documents;
begin
  update public.documents document set category = p_category
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'category_changed',
    jsonb_build_object('from', v_document.category, 'to', v_updated.category)
  );
  return v_updated;
end;
$$;

-- Moves a document into a folder or the library root under the free name the
-- action chose. Refusals: not_authorized, document_not_found,
-- protected_document_boundary, invalid_target, folder_not_found; a taken name
-- fails on the unique name index.
create function public.move_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_folder_id uuid,
  p_display_name text
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_active_document(p_actor_id, p_organization_id, p_document_id);
  v_updated public.documents;
begin
  if exists (
    select 1 from public.personnel_documents protected
    where protected.organization_id = p_organization_id and protected.document_id = p_document_id
  ) then
    raise exception 'protected_document_boundary';
  end if;
  if v_document.folder_id is not distinct from p_folder_id then
    raise exception 'invalid_target';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.document_folders folder
    where folder.id = p_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  ) then
    raise exception 'folder_not_found';
  end if;
  update public.documents document set folder_id = p_folder_id, display_name = p_display_name
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_folder_id, p_actor_id, 'moved',
    jsonb_build_object(
      'fromFolderId', v_document.folder_id, 'toFolderId', p_folder_id,
      'displayNameChanged', v_document.display_name <> v_updated.display_name
    )
  );
  return v_updated;
end;
$$;

-- Registers the copy of a document whose object the action copied before the
-- call. Refusals: not_authorized, document_not_found,
-- protected_document_boundary, folder_not_found; a taken name fails on the
-- unique name index.
create function public.copy_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_source_document_id uuid,
  p_document_id uuid,
  p_folder_id uuid,
  p_storage_path text,
  p_display_name text
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_source public.documents := app_private.lock_active_document(
    p_actor_id, p_organization_id, p_source_document_id
  );
  v_copy public.documents;
begin
  if exists (
    select 1 from public.personnel_documents protected
    where protected.organization_id = p_organization_id
      and protected.document_id = p_source_document_id
  ) then
    raise exception 'protected_document_boundary';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.document_folders folder
    where folder.id = p_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  ) then
    raise exception 'folder_not_found';
  end if;
  insert into public.documents (
    id, organization_id, folder_id, storage_bucket, storage_path, original_file_name, display_name,
    category, mime_type, size_bytes, uploaded_by, copied_from_document_id, metadata
  ) values (
    p_document_id, p_organization_id, p_folder_id, v_source.storage_bucket, p_storage_path,
    v_source.original_file_name, p_display_name, v_source.category, v_source.mime_type,
    v_source.size_bytes, p_actor_id, v_source.id, v_source.metadata
  )
  returning * into v_copy;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_folder_id, p_actor_id, 'copied',
    jsonb_build_object(
      'copiedFromDocumentId', v_source.id, 'sourceStoragePath', v_source.storage_path,
      'storagePath', v_copy.storage_path
    )
  );
  return v_copy;
end;
$$;

-- Moves an active document to the trash. Refusals: not_authorized,
-- document_not_found.
create function public.trash_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_active_document(p_actor_id, p_organization_id, p_document_id);
begin
  update public.documents document set
    deleted_at = now(), deleted_by = p_actor_id, delete_reason = 'user_deleted'
  where document.id = p_document_id and document.organization_id = p_organization_id;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'deleted',
    jsonb_build_object('reason', 'user_deleted', 'storagePath', v_document.storage_path)
  );
end;
$$;

-- Restores a trashed document into its folder, or into the library root when
-- that folder is gone, under the free name the action chose. Refusals:
-- not_authorized, document_not_found; a taken name fails on the unique name
-- index.
create function public.restore_document(
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

-- Deletes a trashed document row with its versions and links and records the
-- deletion. Returns the storage paths of the current file and of every
-- version, which the action removes after the commit: a refused deletion
-- leaves every object in place. Refusals: not_authorized, document_not_found,
-- document_has_equipment_history; a protected personnel document, a released
-- handover or another restricting reference fails in its trigger or foreign
-- key.
create function public.permanently_delete_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_storage_paths text[];
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
    select 1 from public.document_links link
    where link.organization_id = p_organization_id and link.document_id = p_document_id
      and link.equipment_id is not null
  ) then
    raise exception 'document_has_equipment_history';
  end if;
  v_storage_paths := array[v_document.storage_path] || array(
    select version.storage_path from public.document_versions version
    where version.organization_id = p_organization_id and version.document_id = p_document_id
    order by version.version_number
  );
  delete from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id;
  insert into public.document_audit_events (
    organization_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, v_document.folder_id, p_actor_id, 'permanently_deleted',
    jsonb_build_object(
      'documentId', p_document_id, 'displayName', v_document.display_name,
      'storagePaths', to_jsonb(v_storage_paths)
    )
  );
  return v_storage_paths;
end;
$$;

revoke all on function app_private.lock_active_document(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.rename_document(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.update_document_category(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.move_document(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.copy_document(uuid, uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.trash_document(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_document(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.permanently_delete_document(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rename_document(uuid, uuid, uuid, text) to service_role;
grant execute on function public.update_document_category(uuid, uuid, uuid, text) to service_role;
grant execute on function public.move_document(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.copy_document(uuid, uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.trash_document(uuid, uuid, uuid) to service_role;
grant execute on function public.restore_document(uuid, uuid, uuid, text) to service_role;
grant execute on function public.permanently_delete_document(uuid, uuid, uuid) to service_role;
