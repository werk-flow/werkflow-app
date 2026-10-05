-- The document writes that touch several rows are one function call each, and
-- so one transaction. The server actions in lib/documents/actions.ts wrote the
-- document, its link and its audit events in consecutive statements, so a
-- refused later statement left a document without its link, a link without
-- its audit event, or half a folder deletion behind.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the target permission in TypeScript, verifies the uploaded
-- object and passes only server-resolved values. Each function repeats the
-- role and state checks under lock, changes everything or nothing and raises
-- the action failure code of the first refusal. Storage is not transactional:
-- an action writes its object before the call and discards it when the call
-- refuses.
--
-- Signals stay as before: the writes reach the Realtime publication through
-- their tables, and a deleted link writes its realtime_deletions notice
-- through the emit_realtime_deletion trigger.

-- Registers an uploaded object as a document with its optional link and its
-- audit events. A manager uploads anywhere; another member uploads only to a
-- job assigned to them, outside any folder. Refusals: invalid_target,
-- not_a_member, not_authorized, folder_not_found, already_finalized,
-- create_failed, link_failed.
create function public.finalize_document_upload(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_folder_id uuid,
  p_storage_path text,
  p_original_file_name text,
  p_display_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_link_kind text,
  p_link_target_id uuid
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_constraint text;
  v_job_id uuid := case when p_link_kind = 'job' then p_link_target_id end;
  v_project_id uuid := case when p_link_kind = 'project' then p_link_target_id end;
  v_client_id uuid := case when p_link_kind = 'client' then p_link_target_id end;
  v_employee_id uuid := case when p_link_kind = 'employee' then p_link_target_id end;
  v_request_id uuid := case when p_link_kind = 'request' then p_link_target_id end;
  v_equipment_id uuid := case when p_link_kind = 'equipment' then p_link_target_id end;
  v_service_case_id uuid := case when p_link_kind = 'service_case' then p_link_target_id end;
  v_coverage_id uuid := case when p_link_kind = 'maintenance_coverage' then p_link_target_id end;
  v_target_payload jsonb;
begin
  if (p_link_kind is null) <> (p_link_target_id is null)
    or p_link_kind not in (
      'job', 'project', 'client', 'employee', 'request', 'equipment', 'service_case', 'maintenance_coverage'
    )
  then
    raise exception 'invalid_target';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ) then
    raise exception 'not_a_member';
  end if;
  if not app_private.is_document_manager(p_organization_id, p_actor_id)
    and not (
      p_link_kind = 'job' and p_folder_id is null and exists (
        select 1 from public.job_assignments assignment
        where assignment.organization_id = p_organization_id
          and assignment.job_id = p_link_target_id
          and assignment.user_id = p_actor_id
      )
    )
  then
    raise exception 'not_authorized';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.document_folders folder
    where folder.id = p_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  ) then
    raise exception 'folder_not_found';
  end if;

  begin
    insert into public.documents (
      id, organization_id, folder_id, storage_path, original_file_name, display_name,
      category, mime_type, size_bytes, uploaded_by
    ) values (
      p_document_id, p_organization_id, p_folder_id, p_storage_path, p_original_file_name,
      p_display_name, p_category, p_mime_type, p_size_bytes, p_actor_id
    )
    returning * into v_document;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- A concurrent finalize of the same upload committed first and owns the object.
    if v_constraint in ('documents_pkey', 'documents_storage_path_key') then
      raise exception 'already_finalized';
    end if;
    raise exception 'create_failed';
  end;

  if p_link_kind is not null then
    begin
      insert into public.document_links (
        organization_id, document_id, job_id, project_id, client_id, employee_id, request_id,
        equipment_id, service_case_id, maintenance_coverage_id, created_by
      ) values (
        p_organization_id, p_document_id, v_job_id, v_project_id, v_client_id, v_employee_id,
        v_request_id, v_equipment_id, v_service_case_id, v_coverage_id, p_actor_id
      );
    exception when others then
      raise exception 'link_failed';
    end;
  end if;

  v_target_payload := jsonb_build_object(
    'jobId', v_job_id, 'projectId', v_project_id, 'clientId', v_client_id,
    'employeeId', v_employee_id, 'requestId', v_request_id, 'equipmentId', v_equipment_id,
    'serviceCaseId', v_service_case_id, 'maintenanceCoverageId', v_coverage_id
  );
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_folder_id, p_actor_id, 'uploaded',
    jsonb_build_object(
      'displayName', v_document.display_name, 'originalFileName', v_document.original_file_name,
      'category', v_document.category, 'sizeBytes', v_document.size_bytes,
      'mimeType', v_document.mime_type
    ) || v_target_payload
  );
  if p_link_kind is not null then
    insert into public.document_audit_events (
      organization_id, document_id, actor_id, event_type, event_payload
    ) values (p_organization_id, p_document_id, p_actor_id, 'linked', v_target_payload);
  end if;
  return v_document;
end;
$$;

-- Archives the current file of a versioned document and makes the uploaded
-- object its new current version, with its audit event. Refusals:
-- not_authorized, document_not_found, versioning_not_supported,
-- version_conflict.
create function public.finalize_document_version_upload(
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

-- Moves a folder, its active subfolders and their active documents to the
-- trash, with one audit event per document. Returns the number of deleted
-- documents. Refusals: not_authorized, folder_not_found.
create function public.delete_document_folder(
  p_actor_id uuid,
  p_organization_id uuid,
  p_folder_id uuid
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_folder_ids uuid[];
  v_deleted_count integer;
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  perform 1 from public.document_folders folder
  where folder.id = p_folder_id and folder.organization_id = p_organization_id
    and folder.deleted_at is null
  for update;
  if not found then
    raise exception 'folder_not_found';
  end if;

  -- UNION drops repeated rows, so a parent cycle left by two concurrent moves ends the walk.
  with recursive tree(id) as (
    select p_folder_id
    union
    select child.id from public.document_folders child
    join tree on child.parent_folder_id = tree.id
    where child.organization_id = p_organization_id and child.deleted_at is null
  )
  select array_agg(tree.id) into v_folder_ids from tree;

  with deleted as (
    update public.documents document set
      deleted_at = now(), deleted_by = p_actor_id, delete_reason = 'folder_deleted'
    where document.organization_id = p_organization_id
      and document.folder_id = any(v_folder_ids)
      and document.deleted_at is null
    returning document.id, document.storage_path
  )
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  )
  select p_organization_id, deleted.id, p_folder_id, p_actor_id, 'deleted',
    jsonb_build_object('reason', 'folder_deleted', 'storagePath', deleted.storage_path)
  from deleted;
  get diagnostics v_deleted_count = row_count;

  update public.document_folders folder set deleted_at = now()
  where folder.organization_id = p_organization_id and folder.id = any(v_folder_ids);
  return v_deleted_count;
end;
$$;

-- Removes and adds the links of one document, each with its audit event.
-- Equipment, service-case and maintenance-coverage links leave through their
-- history-keeping functions. An existing link counts as added without a
-- second event. Refusals: not_authorized, document_not_found,
-- link_not_found; a target outside the organization or a protected personnel
-- document fails in the link triggers.
create function public.update_document_links(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_remove_link_ids uuid[],
  p_add_job_ids uuid[],
  p_add_project_ids uuid[],
  p_add_client_ids uuid[],
  p_add_employee_ids uuid[],
  p_add_equipment_ids uuid[],
  p_add_service_case_ids uuid[],
  p_add_maintenance_coverage_ids uuid[]
)
returns table (added_count integer, removed_count integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_remove_ids uuid[] := array(select distinct unnest(coalesce(p_remove_link_ids, '{}')));
  v_link public.document_links;
  v_version bigint;
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  perform 1 from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is null
  for update;
  if not found then
    raise exception 'document_not_found';
  end if;
  if (
    select count(*) from public.document_links link
    where link.organization_id = p_organization_id and link.document_id = p_document_id
      and link.id = any(v_remove_ids)
  ) <> cardinality(v_remove_ids) then
    raise exception 'link_not_found';
  end if;

  for v_link in
    select * from public.document_links link
    where link.organization_id = p_organization_id and link.id = any(v_remove_ids)
    order by link.id
    for update
  loop
    if v_link.equipment_id is not null then
      perform public.unlink_installed_equipment_document(
        p_organization_id, v_link.id, p_actor_id, v_link.id
      );
    elsif v_link.service_case_id is not null then
      select service_case.version into v_version from public.service_cases service_case
      where service_case.id = v_link.service_case_id
        and service_case.organization_id = p_organization_id;
      perform public.unlink_service_case_document(
        p_organization_id, v_link.id, v_version, 'Dokumentverknüpfung entfernt', p_actor_id, v_link.id
      );
    elsif v_link.maintenance_coverage_id is not null then
      select coverage.version into v_version from public.maintenance_coverages coverage
      where coverage.id = v_link.maintenance_coverage_id
        and coverage.organization_id = p_organization_id;
      perform public.unlink_maintenance_coverage_document(
        p_organization_id, v_link.id, v_version, 'Dokumentverknüpfung entfernt', p_actor_id, v_link.id
      );
    else
      delete from public.document_links link
      where link.id = v_link.id and link.organization_id = p_organization_id;
    end if;
    insert into public.document_audit_events (
      organization_id, document_id, actor_id, event_type, event_payload
    ) values (
      p_organization_id, p_document_id, p_actor_id, 'unlinked',
      jsonb_build_object(
        'jobId', v_link.job_id, 'projectId', v_link.project_id, 'clientId', v_link.client_id,
        'employeeId', v_link.employee_id, 'requestId', v_link.request_id,
        'equipmentId', v_link.equipment_id, 'serviceCaseId', v_link.service_case_id,
        'maintenanceCoverageId', v_link.maintenance_coverage_id
      )
    );
  end loop;

  with requested (job_id, project_id, client_id, employee_id, equipment_id, service_case_id,
    maintenance_coverage_id) as (
    select target_id, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid
    from unnest(coalesce(p_add_job_ids, '{}')) target_id
    union all
    select null, target_id, null, null, null, null, null
    from unnest(coalesce(p_add_project_ids, '{}')) target_id
    union all
    select null, null, target_id, null, null, null, null
    from unnest(coalesce(p_add_client_ids, '{}')) target_id
    union all
    select null, null, null, target_id, null, null, null
    from unnest(coalesce(p_add_employee_ids, '{}')) target_id
    union all
    select null, null, null, null, target_id, null, null
    from unnest(coalesce(p_add_equipment_ids, '{}')) target_id
    union all
    select null, null, null, null, null, target_id, null
    from unnest(coalesce(p_add_service_case_ids, '{}')) target_id
    union all
    select null, null, null, null, null, null, target_id
    from unnest(coalesce(p_add_maintenance_coverage_ids, '{}')) target_id
  ),
  added as (
    insert into public.document_links (
      organization_id, document_id, job_id, project_id, client_id, employee_id, equipment_id,
      service_case_id, maintenance_coverage_id, created_by
    )
    select p_organization_id, p_document_id, requested.job_id, requested.project_id,
      requested.client_id, requested.employee_id, requested.equipment_id,
      requested.service_case_id, requested.maintenance_coverage_id, p_actor_id
    from requested
    on conflict do nothing
    returning *
  )
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  )
  select p_organization_id, p_document_id, p_actor_id, 'linked',
    jsonb_strip_nulls(jsonb_build_object(
      'jobId', added.job_id, 'projectId', added.project_id, 'clientId', added.client_id,
      'employeeId', added.employee_id, 'equipmentId', added.equipment_id,
      'serviceCaseId', added.service_case_id, 'maintenanceCoverageId', added.maintenance_coverage_id
    ))
  from added;

  -- Every requested target is linked now, the ones linked before included.
  added_count := coalesce(cardinality(p_add_job_ids), 0) + coalesce(cardinality(p_add_project_ids), 0)
    + coalesce(cardinality(p_add_client_ids), 0) + coalesce(cardinality(p_add_employee_ids), 0)
    + coalesce(cardinality(p_add_equipment_ids), 0) + coalesce(cardinality(p_add_service_case_ids), 0)
    + coalesce(cardinality(p_add_maintenance_coverage_ids), 0);
  removed_count := cardinality(v_remove_ids);
  return next;
end;
$$;

-- Creates a planned copy of a folder tree and of its documents, with their
-- audit events, and returns the copied root folder. The action plans the ids,
-- the free names and the storage paths, and copies every object before the
-- call. p_folders lists {id, parentFolderId, name} with the root first and
-- every parent before its children; p_documents lists {id, sourceDocumentId,
-- folderId, storagePath, displayName}. Refusals: not_authorized,
-- folder_not_found, invalid_target, document_not_found; a taken name fails on
-- the unique name index.
create function public.copy_document_folder(
  p_actor_id uuid,
  p_organization_id uuid,
  p_source_folder_id uuid,
  p_target_parent_folder_id uuid,
  p_folders jsonb,
  p_documents jsonb
)
returns public.document_folders
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_folder record;
  v_root public.document_folders;
  v_planned_ids uuid[] := '{}';
  v_document_count integer := jsonb_array_length(coalesce(p_documents, '[]'));
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if not exists (
    select 1 from public.document_folders folder
    where folder.id = p_source_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  ) or (p_target_parent_folder_id is not null and not exists (
    select 1 from public.document_folders folder
    where folder.id = p_target_parent_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  )) then
    raise exception 'folder_not_found';
  end if;
  if jsonb_typeof(p_folders) is distinct from 'array' or jsonb_array_length(p_folders) = 0
    or jsonb_typeof(coalesce(p_documents, '[]')) <> 'array'
  then
    raise exception 'invalid_target';
  end if;
  if (
    select count(*) from jsonb_to_recordset(coalesce(p_documents, '[]')) planned("sourceDocumentId" uuid)
    join public.documents source on source.id = planned."sourceDocumentId"
    where source.organization_id = p_organization_id and source.deleted_at is null
  ) <> v_document_count then
    raise exception 'document_not_found';
  end if;

  for v_folder in
    select planned.id, planned.parent_folder_id, planned.name, planned.position
    from rows from (jsonb_to_recordset(p_folders) as (id uuid, "parentFolderId" uuid, name text))
      with ordinality as planned(id, parent_folder_id, name, position)
    order by planned.position
  loop
    -- The root hangs below the target; every other folder below a folder of this copy.
    if (v_folder.position = 1 and v_folder.parent_folder_id is distinct from p_target_parent_folder_id)
      or (v_folder.position > 1 and v_folder.parent_folder_id <> all (v_planned_ids))
    then
      raise exception 'invalid_target';
    end if;
    insert into public.document_folders (id, organization_id, parent_folder_id, name, created_by)
    values (v_folder.id, p_organization_id, v_folder.parent_folder_id, v_folder.name, p_actor_id);
    v_planned_ids := v_planned_ids || v_folder.id;
  end loop;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_documents, '[]')) planned("folderId" uuid)
    where planned."folderId" <> all (v_planned_ids)
  ) then
    raise exception 'invalid_target';
  end if;

  with copied as (
    insert into public.documents (
      id, organization_id, folder_id, storage_bucket, storage_path, original_file_name,
      display_name, category, mime_type, size_bytes, uploaded_by, copied_from_document_id, metadata
    )
    select planned.id, p_organization_id, planned."folderId", source.storage_bucket,
      planned."storagePath", source.original_file_name, planned."displayName", source.category,
      source.mime_type, source.size_bytes, p_actor_id, source.id, source.metadata
    from jsonb_to_recordset(coalesce(p_documents, '[]'))
      as planned(id uuid, "sourceDocumentId" uuid, "folderId" uuid, "storagePath" text, "displayName" text)
    join public.documents source
      on source.id = planned."sourceDocumentId" and source.organization_id = p_organization_id
    returning documents.id, documents.folder_id, documents.storage_path, documents.copied_from_document_id
  )
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  )
  select p_organization_id, copied.id, copied.folder_id, p_actor_id, 'copied',
    jsonb_build_object(
      'copiedFromDocumentId', copied.copied_from_document_id,
      'copiedFromFolderId', p_source_folder_id,
      'sourceStoragePath', source.storage_path,
      'storagePath', copied.storage_path
    )
  from copied
  join public.documents source on source.id = copied.copied_from_document_id;

  select * into v_root from public.document_folders folder where folder.id = v_planned_ids[1];
  insert into public.document_audit_events (
    organization_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, v_root.id, p_actor_id, 'copied',
    jsonb_build_object(
      'copiedFromFolderId', p_source_folder_id,
      'toParentFolderId', p_target_parent_folder_id,
      'copiedFolderCount', cardinality(v_planned_ids),
      'copiedDocumentCount', v_document_count
    )
  );
  return v_root;
end;
$$;

revoke all on function public.finalize_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_document_version_upload(
  uuid, uuid, uuid, integer, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.delete_document_folder(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_document_links(
  uuid, uuid, uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) from public, anon, authenticated;
revoke all on function public.copy_document_folder(uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_document_upload(
  uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, uuid
) to service_role;
grant execute on function public.finalize_document_version_upload(
  uuid, uuid, uuid, integer, text, text, text, bigint
) to service_role;
grant execute on function public.delete_document_folder(uuid, uuid, uuid) to service_role;
grant execute on function public.update_document_links(
  uuid, uuid, uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) to service_role;
grant execute on function public.copy_document_folder(uuid, uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
