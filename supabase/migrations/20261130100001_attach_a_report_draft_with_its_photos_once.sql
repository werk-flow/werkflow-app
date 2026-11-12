-- A report draft a phone wrote without signal reaches the server as one
-- operation of field sync v1, `work_artifact.draft` (decision record 0010;
-- werk-flow/werkflow-planning#320): the draft revision of a new
-- Arbeitsnachweis on a job and the links to its photos are written in one
-- call, or not at all. The photos are job documents the same person uploaded
-- through the document upload path before; the operation names their ids,
-- never bytes or a storage key.
--
-- - A draft stays a draft: the revision is never submitted, and no review,
--   customer decision or signature is recorded here.
-- - The caller is a current member, the job belongs to the organization, and a
--   field worker is assigned to it. Each is checked here again, in the write's
--   own transaction, whatever the server caller checked before.
-- - A resend of a stored operation answers its first result as replayed,
--   before the job checks: the person learns that the draft arrived even when
--   the office took the job from them meanwhile. The same operation id with
--   other content, or from another person or organization, is refused.
-- - A photo must be an undeleted document of the organization that the caller
--   uploaded and that is linked to this job.

-- One row per accepted draft operation: the idempotency key, the hash of what
-- was sent and the device's clocks. Server-only; rows leave with their
-- revision or organization.
create table public.work_artifact_draft_operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The person who sent it: the author of the revision, whose row holds the reference to the user.
  actor_id uuid not null,
  revision_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null,
  sent_at timestamptz not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint work_artifact_draft_operations_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions (id, organization_id) on delete cascade,
  constraint work_artifact_draft_operations_revision_unique unique (revision_id)
);

comment on table public.work_artifact_draft_operations is
  'Accepted work_artifact.draft operations of field sync v1 (decision record 0010): operation id, request hash, the device clocks and the first result, which a resend answers as replayed. created_at is the receipt time.';

create index work_artifact_draft_operations_org_idx
  on public.work_artifact_draft_operations (organization_id);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.work_artifact_draft_operations enable row level security;

revoke all on table public.work_artifact_draft_operations from public, anon, authenticated, service_role;
grant select, insert on table public.work_artifact_draft_operations to service_role;

create function public.attach_work_artifact_draft(
  p_organization_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_captured_at timestamptz,
  p_sent_at timestamptz,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_job_id uuid,
  p_kind public.work_artifact_kind,
  p_visibility public.work_artifact_visibility,
  p_recorded_at timestamptz,
  p_title text,
  p_content jsonb,
  p_photos jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_artifact_draft_operations%rowtype;
  v_revision jsonb;
  v_link jsonb;
  v_photo jsonb;
  v_document_id uuid;
  v_version bigint;
  v_result jsonb;
begin
  if p_organization_id is null or p_actor_id is null or p_operation_id is null
    or p_artifact_id is null or p_revision_id is null or p_job_id is null
    or p_captured_at is null or p_sent_at is null or p_recorded_at is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_photos, 'null'::jsonb)) <> 'array'
  then raise exception 'work_artifact_draft_invalid_input'; end if;

  -- Operation ids are globally unique: the same id is serialized across tenants.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));

  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_existing
  from public.work_artifact_draft_operations operation
  where operation.id = p_operation_id;
  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.actor_id <> p_actor_id
      or v_existing.request_hash <> p_request_hash
    then raise exception 'work_artifact_draft_idempotency_conflict'; end if;
    return v_existing.result_payload || jsonb_build_object('replayed', true);
  end if;

  if not exists (
    select 1 from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id
  ) or not app_private.can_access_work_artifact_target(
    p_organization_id, p_job_id, null, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  -- A new Arbeitsnachweis only (expected version 0), and never submitted.
  v_revision := public.create_work_artifact_revision(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, 0,
    p_job_id, null, p_kind, p_visibility, p_recorded_at, p_title, p_content,
    null, null, false, null
  );
  -- The revision id is this draft's alone. One that exists without the
  -- operation was written by the author's own online save of the same draft
  -- whose answer was lost (it carries the draft's revision id and no photos):
  -- the operation then records that save and answers `replayed`. Anything else
  -- was written by another call.
  if (v_revision->>'duplicate')::boolean then
    if jsonb_array_length(p_photos) > 0 or not exists (
      select 1 from public.work_artifact_revisions revision
      where revision.id = p_revision_id
        and revision.artifact_id = p_artifact_id
        and revision.organization_id = p_organization_id
        and revision.created_by = p_actor_id
    ) then raise exception 'work_artifact_draft_idempotency_conflict'; end if;
    v_result := jsonb_build_object(
      'artifactId', p_artifact_id, 'revisionId', p_revision_id,
      'version', (v_revision->>'version')::bigint, 'replayed', false
    );
    insert into public.work_artifact_draft_operations (
      id, organization_id, actor_id, revision_id, request_hash,
      captured_at, sent_at, result_payload
    ) values (
      p_operation_id, p_organization_id, p_actor_id, p_revision_id, p_request_hash,
      p_captured_at, p_sent_at, v_result
    );
    return v_result || jsonb_build_object('replayed', true);
  end if;
  v_version := (v_revision->>'version')::bigint;

  for v_photo in select value from jsonb_array_elements(p_photos)
  loop
    v_document_id := (v_photo->>'documentId')::uuid;
    if not exists (
      select 1
      from public.documents document
      join public.document_links link
        on link.document_id = document.id and link.organization_id = document.organization_id
      where document.id = v_document_id
        and document.organization_id = p_organization_id
        and document.deleted_at is null
        and document.uploaded_by = p_actor_id
        and link.job_id = p_job_id
    ) then raise exception 'work_artifact_draft_photo_invalid'; end if;
    v_link := public.link_work_artifact_document(
      p_organization_id, p_actor_id, p_artifact_id, p_revision_id,
      (v_photo->>'linkId')::uuid, v_version, v_document_id,
      'supporting_evidence', null, null, null
    );
    -- A link id that exists was written by another call.
    if (v_link->>'duplicate')::boolean then
      raise exception 'work_artifact_draft_idempotency_conflict';
    end if;
    v_version := (v_link->>'version')::bigint;
  end loop;

  v_result := jsonb_build_object(
    'artifactId', p_artifact_id, 'revisionId', p_revision_id,
    'version', v_version, 'replayed', false
  );
  insert into public.work_artifact_draft_operations (
    id, organization_id, actor_id, revision_id, request_hash,
    captured_at, sent_at, result_payload
  ) values (
    p_operation_id, p_organization_id, p_actor_id, p_revision_id, p_request_hash, p_captured_at, p_sent_at, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.attach_work_artifact_draft(
  uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, uuid,
  public.work_artifact_kind, public.work_artifact_visibility, timestamptz, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.attach_work_artifact_draft(
  uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, uuid,
  public.work_artifact_kind, public.work_artifact_visibility, timestamptz, text, jsonb, jsonb
) to service_role;
