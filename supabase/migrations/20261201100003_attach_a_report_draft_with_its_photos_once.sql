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
-- - A revision the author's own online save of the draft wrote under the
--   draft's revision id is adopted only for the same state of the draft
--   (`draft_changed_at`); any other is a version conflict.

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

-- The device's last-change time of the draft a revision was written from. The
-- online save of a device draft writes it, and so does the attach; the attach
-- adopts a revision its draft's online save wrote only for the same value, so
-- a draft changed after that save is never dropped as `replayed`. Server-only
-- like the rest of the table (no client role reads work_artifact_revisions).
alter table public.work_artifact_revisions add column draft_changed_at timestamptz;

comment on column public.work_artifact_revisions.draft_changed_at is
  'The device''s last-change time of the report draft this revision was written from (decision record 0010). Null for every revision not written from a device draft.';

-- The revision writer with the draft's marker. The earlier signature stays and
-- writes no marker, so the previous release and every other caller keep their
-- behavior.
create function public.create_work_artifact_revision(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_kind public.work_artifact_kind,
  p_visibility public.work_artifact_visibility,
  p_captured_at timestamptz,
  p_title text,
  p_content jsonb,
  p_corrects_revision_id uuid,
  p_correction_reason text,
  p_submit boolean,
  p_submit_action_id uuid,
  p_draft_changed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing_revision public.work_artifact_revisions%rowtype;
  v_revision_number integer;
  v_resulting_version bigint;
  v_line jsonb;
  v_line_number integer := 0;
begin
  select * into v_existing_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id;
  if found then
    if v_existing_revision.artifact_id <> p_artifact_id
      or v_existing_revision.organization_id <> p_organization_id then
      raise exception 'work_artifact_revision_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    if not app_private.can_access_work_artifact_target(
      p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
    ) then raise exception 'work_artifact_not_authorized'; end if;
    return jsonb_build_object(
      'artifactId', p_artifact_id, 'revisionId', p_revision_id,
      'revisionNumber', v_existing_revision.revision_number,
      'version', v_artifact.version, 'status', v_artifact.status, 'duplicate', true
    );
  end if;

  if not app_private.can_access_work_artifact_target(
    p_organization_id, p_job_id, p_project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id for update;

  if not found then
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'work_artifact_stale_version';
    end if;
    insert into public.work_artifacts (
      id, organization_id, job_id, project_id, kind, status, version, created_by
    ) values (
      p_artifact_id, p_organization_id, p_job_id, p_project_id, p_kind,
      case when p_submit then 'submitted'::public.work_artifact_status
        else 'draft'::public.work_artifact_status end, 1, p_actor_id
    ) returning * into v_artifact;
    v_revision_number := 1;
    v_resulting_version := 1;
  else
    if v_artifact.organization_id <> p_organization_id
      or v_artifact.job_id is distinct from p_job_id
      or v_artifact.project_id is distinct from p_project_id
      or v_artifact.kind <> p_kind then
      raise exception 'work_artifact_identity_mismatch';
    end if;
    if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
    if v_artifact.version is distinct from p_expected_version then
      raise exception 'work_artifact_stale_version';
    end if;
    -- A coworker's internal draft stays with its author: only the author or
    -- a manager writes its next revision.
    if exists (
      select 1 from public.work_artifact_revisions current_revision
      where current_revision.id = v_artifact.current_revision_id
        and current_revision.visibility = 'internal_only'
        and current_revision.created_by <> p_actor_id
    ) and not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
    then raise exception 'work_artifact_not_authorized'; end if;
    if v_artifact.current_revision_id is not null
      and (v_artifact.status <> 'draft' or exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = v_artifact.current_revision_id
      ))
      and (p_corrects_revision_id is distinct from v_artifact.current_revision_id
        or length(btrim(p_correction_reason)) < 3)
    then raise exception 'work_artifact_correction_reason_required'; end if;

    select coalesce(max(revision.revision_number), 0) + 1 into v_revision_number
    from public.work_artifact_revisions revision
    where revision.artifact_id = p_artifact_id;
    v_resulting_version := v_artifact.version + 1;
  end if;

  insert into public.work_artifact_revisions (
    id, organization_id, artifact_id, revision_number, kind, visibility,
    captured_at, site_id, instruction_item_id, title, summary, customer_statement,
    corrects_revision_id, correction_reason, requires_customer_response,
    requires_signature, work_date, progress, people_present, weather_conditions,
    site_conditions, deliveries, impediments, decisions, notable_events,
    visit_started_at, visit_ended_at, performed_work, outstanding_work,
    materials_summary, next_visit_at, measurement_date, measurement_location,
    measurement_notes, created_by, draft_changed_at
  ) values (
    p_revision_id, p_organization_id, p_artifact_id, v_revision_number, p_kind,
    p_visibility, p_captured_at,
    nullif(p_content->>'siteId', '')::uuid,
    nullif(p_content->>'instructionItemId', '')::uuid,
    btrim(p_title), nullif(btrim(p_content->>'summary'), ''),
    nullif(btrim(p_content->>'customerStatement'), ''), p_corrects_revision_id,
    nullif(btrim(p_correction_reason), ''),
    coalesce((p_content->>'requiresCustomerResponse')::boolean, false),
    coalesce((p_content->>'requiresSignature')::boolean, false),
    nullif(p_content->>'workDate', '')::date,
    nullif(btrim(p_content->>'progress'), ''),
    nullif(btrim(p_content->>'peoplePresent'), ''),
    nullif(btrim(p_content->>'weatherConditions'), ''),
    nullif(btrim(p_content->>'siteConditions'), ''),
    nullif(btrim(p_content->>'deliveries'), ''),
    nullif(btrim(p_content->>'impediments'), ''),
    nullif(btrim(p_content->>'decisions'), ''),
    nullif(btrim(p_content->>'notableEvents'), ''),
    nullif(p_content->>'visitStartedAt', '')::timestamptz,
    nullif(p_content->>'visitEndedAt', '')::timestamptz,
    nullif(btrim(p_content->>'performedWork'), ''),
    nullif(btrim(p_content->>'outstandingWork'), ''),
    nullif(btrim(p_content->>'materialsSummary'), ''),
    nullif(p_content->>'nextVisitAt', '')::timestamptz,
    nullif(p_content->>'measurementDate', '')::date,
    nullif(btrim(p_content->>'measurementLocation'), ''),
    nullif(btrim(p_content->>'measurementNotes'), ''), p_actor_id, p_draft_changed_at
  );

  if p_kind = 'measurement' then
    for v_line in select value from jsonb_array_elements(coalesce(p_content->'measurementLines', '[]'::jsonb))
    loop
      v_line_number := v_line_number + 1;
      insert into public.work_artifact_measurement_lines (
        id, organization_id, revision_id, line_number, description, location,
        quantity, unit, note
      ) values (
        coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid()),
        p_organization_id, p_revision_id, v_line_number,
        btrim(v_line->>'description'), nullif(btrim(v_line->>'location'), ''),
        (v_line->>'quantity')::numeric(14,3),
        (v_line->>'unit')::public.work_artifact_measurement_unit,
        nullif(btrim(v_line->>'note'), '')
      );
    end loop;
  elsif p_kind = 'defect' then
    insert into public.work_artifact_defect_details (
      revision_id, organization_id, description, severity, location,
      responsible_employee_record_id, responsibility_context, due_date, state,
      proposed_resolution, resolution_summary
    ) values (
      p_revision_id, p_organization_id, btrim(p_content->>'defectDescription'),
      (p_content->>'defectSeverity')::public.work_artifact_defect_severity,
      btrim(p_content->>'defectLocation'),
      nullif(p_content->>'responsibleEmployeeRecordId', '')::uuid,
      nullif(btrim(p_content->>'responsibilityContext'), ''),
      nullif(p_content->>'dueDate', '')::date,
      coalesce(nullif(p_content->>'defectState', '')::public.work_artifact_defect_state, 'open'),
      nullif(btrim(p_content->>'proposedResolution'), ''),
      nullif(btrim(p_content->>'resolutionSummary'), '')
    );
  elsif p_kind = 'change_work' then
    insert into public.work_artifact_change_details (
      revision_id, organization_id, change_description, change_reason,
      requested_by_context, expected_labor_minutes, actual_labor_minutes,
      expected_material_summary, actual_material_summary, authorization_state,
      schedule_impact
    ) values (
      p_revision_id, p_organization_id, btrim(p_content->>'changeDescription'),
      btrim(p_content->>'changeReason'), btrim(p_content->>'requestedByContext'),
      nullif(p_content->>'expectedLaborMinutes', '')::integer,
      nullif(p_content->>'actualLaborMinutes', '')::integer,
      nullif(btrim(p_content->>'expectedMaterialSummary'), ''),
      nullif(btrim(p_content->>'actualMaterialSummary'), ''),
      coalesce(nullif(p_content->>'authorizationState', '')::public.work_artifact_change_authorization_state, 'not_requested'),
      nullif(btrim(p_content->>'scheduleImpact'), '')
    );
  end if;

  if p_submit then perform app_private.validate_submitted_work_artifact_revision(p_revision_id); end if;

  update public.work_artifacts set
    current_revision_id = p_revision_id,
    status = case when p_submit then 'submitted'::public.work_artifact_status
      else 'draft'::public.work_artifact_status end,
    version = v_resulting_version,
    updated_at = now()
  where id = p_artifact_id;

  if p_submit then
    if p_submit_action_id is null then raise exception 'work_artifact_submit_action_id_required'; end if;
    insert into public.work_artifact_actions (
      id, organization_id, artifact_id, revision_id, action_type, created_by
    ) values (
      p_submit_action_id, p_organization_id, p_artifact_id, p_revision_id,
      'review_requested', p_actor_id
    );
  end if;

  return jsonb_build_object(
    'artifactId', p_artifact_id, 'revisionId', p_revision_id,
    'revisionNumber', v_revision_number, 'version', v_resulting_version,
    'status', case when p_submit then 'submitted'::public.work_artifact_status
      else 'draft'::public.work_artifact_status end,
    'duplicate', false
  );
end;
$$;

revoke all on function public.create_work_artifact_revision(
  uuid, uuid, uuid, uuid, bigint, uuid, uuid, public.work_artifact_kind,
  public.work_artifact_visibility, timestamptz, text, jsonb, uuid, text, boolean, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_work_artifact_revision(
  uuid, uuid, uuid, uuid, bigint, uuid, uuid, public.work_artifact_kind,
  public.work_artifact_visibility, timestamptz, text, jsonb, uuid, text, boolean, uuid, timestamptz
) to service_role;

create or replace function public.create_work_artifact_revision(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_kind public.work_artifact_kind,
  p_visibility public.work_artifact_visibility,
  p_captured_at timestamptz,
  p_title text,
  p_content jsonb,
  p_corrects_revision_id uuid,
  p_correction_reason text,
  p_submit boolean,
  p_submit_action_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$
  select public.create_work_artifact_revision(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_expected_version,
    p_job_id, p_project_id, p_kind, p_visibility, p_captured_at, p_title, p_content,
    p_corrects_revision_id, p_correction_reason, p_submit, p_submit_action_id, null
  )
$$;

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
    null, null, false, null, p_captured_at
  );
  -- The revision id is this draft's alone. One that exists without the
  -- operation was written by the author's own online save of the same draft
  -- whose answer was lost: the operation then records that save and answers
  -- `replayed`, but only for the very state of the draft that save wrote (the
  -- same author, Arbeitsnachweis and organization, no photos, and the draft's
  -- last-change time). Anything else is a version conflict: the device keeps
  -- the draft, and nothing is overwritten.
  if (v_revision->>'duplicate')::boolean then
    if jsonb_array_length(p_photos) > 0 or not exists (
      select 1 from public.work_artifact_revisions revision
      where revision.id = p_revision_id
        and revision.artifact_id = p_artifact_id
        and revision.organization_id = p_organization_id
        and revision.created_by = p_actor_id
        and revision.draft_changed_at = p_captured_at
    ) then raise exception 'work_artifact_stale_version'; end if;
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
