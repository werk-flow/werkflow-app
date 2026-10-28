-- Arbeitsnachweis history leaves the Data API. The server reads revisions,
-- actions and their detail rows with the service role and applies the field
-- visibility of lib/work-artifacts/actions.ts; no client path reads them.
-- work_artifacts stays readable for Realtime and the employee attention list,
-- and work_artifact_defect_details stays readable for the attention list of
-- the release before this one.

-- @destructive: after release 81eb219c: no client code reads these tables; the server reads them with the service role
revoke select on table
  public.work_artifact_revisions,
  public.work_artifact_actions,
  public.work_artifact_measurement_lines,
  public.work_artifact_change_details,
  public.work_artifact_revision_documents,
  public.work_artifact_revision_sources
from authenticated;

-- The defect policy read work_artifact_revisions as the querying role, which
-- no longer has that grant. The helper keeps the same rule: the revision's
-- artifact is on a target the user may access.
create function app_private.can_access_work_artifact_revision(
  p_revision_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.work_artifact_revisions revision
    where revision.id = p_revision_id
      and app_private.can_access_work_artifact(revision.artifact_id, p_user_id)
  );
$$;
revoke all on function app_private.can_access_work_artifact_revision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_access_work_artifact_revision(uuid, uuid)
  to authenticated, service_role;

-- @destructive: after release 81eb219c: the same rule through a helper that does not need the revoked grant
alter policy "Authorized users can view work artifact defect details"
  on public.work_artifact_defect_details
  using (app_private.can_access_work_artifact_revision(revision_id, (select auth.uid())));

-- A replayed revision id answers only an actor who may access the artifact's target.
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

-- A replayed action id answers only an actor who may access the artifact's target.
create or replace function public.record_work_artifact_action(
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
  v_existing record;
begin
  select action.organization_id, artifact.job_id, artifact.project_id into v_existing
  from public.work_artifact_actions action
  join public.work_artifacts artifact on artifact.id = action.artifact_id
  where action.id = p_action_id;
  if found then
    if v_existing.organization_id <> p_organization_id then
      raise exception 'work_artifact_action_idempotency_conflict';
    end if;
    if not app_private.can_access_work_artifact_target(
      p_organization_id, v_existing.job_id, v_existing.project_id, p_actor_id
    ) then raise exception 'work_artifact_not_authorized'; end if;
  end if;
  return public.record_work_artifact_action_p1_17_inner(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_action_id,
    p_expected_version, p_action_type, p_reason, p_comment,
    p_responsibility_snapshot, p_customer_context, p_signature_document_id
  );
end;
$$;
