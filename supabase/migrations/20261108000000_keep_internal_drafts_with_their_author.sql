-- A field worker's internal draft stays private until its author or a manager
-- (Admin or Büro) sends it to review. The detail readers in
-- lib/work-artifacts/detail.ts refuse such a draft to an assigned coworker; a
-- review request from that coworker is refused here too, so it can neither
-- move the draft to the office nor make it readable. The rest of the function
-- is unchanged from 20260827150400_reconcile_p1_17_integrations.sql.
create or replace function public.record_work_artifact_action_p1_17_inner(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_action_type public.work_artifact_action_type,
  p_reason text,
  p_comment text,
  p_responsibility_snapshot jsonb,
  p_customer_context jsonb,
  p_signature_document_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_revision public.work_artifact_revisions%rowtype;
  v_existing public.work_artifact_actions%rowtype;
  v_status public.work_artifact_status;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_actions action where action.id = p_action_id;
  if found then
    if v_existing.artifact_id <> p_artifact_id or v_existing.revision_id <> p_revision_id
      or v_existing.action_type <> p_action_type then
      raise exception 'work_artifact_action_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('actionId', p_action_id, 'version', v_artifact.version,
      'status', v_artifact.status, 'duplicate', true);
  end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version then
    raise exception 'work_artifact_stale_version';
  end if;
  if v_artifact.current_revision_id is distinct from p_revision_id then
    raise exception 'work_artifact_action_requires_current_revision';
  end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id and revision.artifact_id = p_artifact_id;

  if p_action_type = 'review_requested'
    and v_artifact.status = 'draft'
    and v_revision.visibility = 'internal_only'
    and v_revision.created_by <> p_actor_id
    and not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
  then raise exception 'work_artifact_not_authorized'; end if;

  if p_action_type in ('internal_approved', 'internal_rejected', 'correction_requested') then
    if v_revision.created_by = p_actor_id then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not app_private.work_artifact_actor_can_approve(p_organization_id, p_actor_id) then
      raise exception 'work_artifact_not_responsible';
    end if;
  end if;

  if p_action_type in (
    'customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured'
  ) and v_revision.visibility <> 'customer_facing' then
    raise exception 'work_artifact_customer_action_requires_customer_visibility';
  end if;

  if p_action_type = 'review_requested' then
    if v_artifact.status not in ('draft', 'rejected', 'correction_requested')
    then raise exception 'work_artifact_review_state_invalid'; end if;
    perform app_private.validate_submitted_work_artifact_revision(p_revision_id);
    v_status := 'submitted';
  elsif p_action_type = 'review_withdrawn' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    if not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
      and not exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = p_revision_id and action.action_type = 'review_requested'
          and action.created_by = p_actor_id
      ) then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
    v_status := 'draft';
  elsif p_action_type = 'internal_approved' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'approved';
  elsif p_action_type = 'internal_rejected' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'rejected';
  elsif p_action_type = 'correction_requested' then
    v_status := 'correction_requested';
  else
    v_status := v_artifact.status;
  end if;

  if p_action_type = 'signature_captured' then
    insert into public.work_artifact_revision_documents (
      id, organization_id, revision_id, document_id, relation, description, created_by
    ) values (
      p_action_id, p_organization_id, p_revision_id, p_signature_document_id,
      'signature_mark', 'Erfasste Unterschrift', p_actor_id
    ) on conflict (revision_id, document_id, relation) do nothing;
  end if;

  insert into public.work_artifact_actions (
    id, organization_id, artifact_id, revision_id, action_type, reason, comment,
    responsibility_snapshot, signer_name, signer_role, signer_relationship,
    signer_company_context, capture_method, wording_snapshot, witness_context,
    signature_document_id, created_by
  ) values (
    p_action_id, p_organization_id, p_artifact_id, p_revision_id, p_action_type,
    nullif(btrim(p_reason), ''), nullif(btrim(p_comment), ''), p_responsibility_snapshot,
    nullif(btrim(p_customer_context->>'signerName'), ''),
    nullif(btrim(p_customer_context->>'signerRole'), ''),
    nullif(btrim(p_customer_context->>'signerRelationship'), ''),
    nullif(btrim(p_customer_context->>'companyContext'), ''),
    nullif(btrim(p_customer_context->>'captureMethod'), ''),
    nullif(btrim(p_customer_context->>'wordingSnapshot'), ''),
    nullif(btrim(p_customer_context->>'witnessContext'), ''),
    p_signature_document_id, p_actor_id
  );

  v_version := v_artifact.version + 1;
  update public.work_artifacts set status = v_status, version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object('actionId', p_action_id, 'version', v_version,
    'status', v_status, 'duplicate', false);
end;
$$;

-- The same rule for the next revision: an assigned coworker cannot write a
-- revision over another person's internal draft and so take it over. Only
-- the author or a manager does. The rest of the function is unchanged from
-- 20261028090000_close_unused_work_artifact_client_reads.sql.
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
    measurement_notes, created_by
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
    nullif(btrim(p_content->>'measurementNotes'), ''), p_actor_id
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
