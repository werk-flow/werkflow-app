-- A customer signature on an Arbeitsnachweis is uploaded as a document before
-- the signature action references it. When the action never runs, the dialog
-- discards that upload. The discard deleted any own photo upload directly,
-- without trash and without an audit event. Now the server reserves the
-- document id when it issues a signature upload ticket, and only a reserved,
-- unused upload of the same person can be discarded. The discard deletes the
-- document and records the deletion in one transaction.

-- One row per signature upload ticket. The document does not exist yet when
-- the ticket is issued, so document_id carries no foreign key; the discard
-- reads the document itself. A reservation of a used signature stays as the
-- record of where the document came from.
create table public.work_artifact_signature_uploads (
  document_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  artifact_id uuid not null references public.work_artifacts (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index work_artifact_signature_uploads_artifact_id_idx
  on public.work_artifact_signature_uploads (artifact_id);
create index work_artifact_signature_uploads_organization_id_idx
  on public.work_artifact_signature_uploads (organization_id);
create index work_artifact_signature_uploads_created_by_idx
  on public.work_artifact_signature_uploads (created_by);

-- RLS without a policy: only the two functions below write the table. Under
-- the default privileges of migration 20260928095752 a new table carries no
-- grant, so the service role gets the read every public table grants it
-- (supabase/tests/security_boundaries.sql) and client roles get nothing.
alter table public.work_artifact_signature_uploads enable row level security;
grant select on table public.work_artifact_signature_uploads to service_role;

-- Reserves a new document id for a signature upload of an artifact that the
-- actor can work on. Refusals: work_artifact_not_found, work_artifact_is_voided,
-- work_artifact_not_authorized, work_artifact_signature_upload_taken (the id
-- names an existing document or reservation).
create function public.reserve_work_artifact_signature_upload(
  p_actor_id uuid,
  p_organization_id uuid,
  p_artifact_id uuid,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id;
  if not found then
    raise exception 'work_artifact_not_found';
  end if;
  if v_artifact.status = 'voided' then
    raise exception 'work_artifact_is_voided';
  end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then
    raise exception 'work_artifact_not_authorized';
  end if;
  if exists (select 1 from public.documents document where document.id = p_document_id)
    or exists (
      select 1 from public.work_artifact_signature_uploads upload where upload.document_id = p_document_id
    )
  then
    raise exception 'work_artifact_signature_upload_taken';
  end if;
  insert into public.work_artifact_signature_uploads (document_id, organization_id, artifact_id, created_by)
  values (p_document_id, p_organization_id, p_artifact_id, p_actor_id);
end;
$$;

-- Discards the actor's own reserved signature upload while no artifact uses
-- it: deletes the document with its links and records the deletion. Returns
-- the storage path of its file, which the action removes after the commit, or
-- null for an upload that was never finalized. Refusals:
-- work_artifact_signature_not_discardable (no reservation of the actor, a
-- document of someone else, or a document that gained versions),
-- work_artifact_signature_in_use.
create function public.discard_work_artifact_signature_upload(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_upload public.work_artifact_signature_uploads;
  v_document public.documents;
begin
  select * into v_upload from public.work_artifact_signature_uploads upload
  where upload.document_id = p_document_id and upload.organization_id = p_organization_id
    and upload.created_by = p_actor_id
  for update;
  if not found then
    raise exception 'work_artifact_signature_not_discardable';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
  for update;
  if found then
    -- A signature upload has exactly its uploaded file.
    if v_document.uploaded_by is distinct from p_actor_id
      or exists (select 1 from public.document_versions version where version.document_id = p_document_id)
    then
      raise exception 'work_artifact_signature_not_discardable';
    end if;
    -- Checked under the row lock: a signature action that references the
    -- document either committed before and is seen here, or waits and then
    -- fails on its foreign key.
    if exists (
      select 1 from public.work_artifact_revision_documents relation
      where relation.document_id = p_document_id
    ) or exists (
      select 1 from public.work_artifact_actions action where action.signature_document_id = p_document_id
    ) then
      raise exception 'work_artifact_signature_in_use';
    end if;
    delete from public.documents document
    where document.id = p_document_id and document.organization_id = p_organization_id;
    insert into public.document_audit_events (
      organization_id, folder_id, actor_id, event_type, event_payload
    ) values (
      p_organization_id, v_document.folder_id, p_actor_id, 'permanently_deleted',
      jsonb_build_object(
        'documentId', p_document_id, 'displayName', v_document.display_name,
        'storagePaths', jsonb_build_array(v_document.storage_path), 'reason', 'discarded_signature_upload',
        'artifactId', v_upload.artifact_id
      )
    );
  end if;
  delete from public.work_artifact_signature_uploads upload where upload.document_id = p_document_id;
  return v_document.storage_path;
end;
$$;

revoke all on function public.reserve_work_artifact_signature_upload(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.discard_work_artifact_signature_upload(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_work_artifact_signature_upload(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.discard_work_artifact_signature_upload(uuid, uuid, uuid) to service_role;
