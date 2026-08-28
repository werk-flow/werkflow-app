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

create or replace function app_private.validate_attention_source_org()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = new.organization_id and member.user_id = new.user_id
  ) then raise exception 'attention state user is not a member of the organization'; end if;

  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (select 1 from public.vacation_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source vacation request organization mismatch'; end if;
  elsif new.source_type = 'sickness_report' then
    if not exists (select 1 from public.sickness_reports report where report.id = new.source_id and report.organization_id = new.organization_id)
      then raise exception 'attention source sickness report organization mismatch'; end if;
  elsif new.source_type = 'employee_certification_expiry' then
    if not exists (select 1 from public.employee_capabilities capability where capability.id = new.source_id and capability.organization_id = new.organization_id and capability.capability_kind = 'certification')
      then raise exception 'attention source employee certification organization mismatch'; end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (select 1 from public.client_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source client request organization mismatch'; end if;
  elsif new.source_type = 'client_follow_up' then
    if not exists (select 1 from public.client_follow_ups follow_up where follow_up.id = new.source_id and follow_up.organization_id = new.organization_id)
      then raise exception 'attention source client follow-up organization mismatch'; end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (select 1 from public.time_entries entry where entry.id = new.source_id and entry.organization_id = new.organization_id)
      then raise exception 'attention source time entry organization mismatch'; end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (select 1 from public.entry_change_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source change request organization mismatch'; end if;
  elsif new.source_type = 'dispatch_acknowledgement' then
    if not exists (select 1 from public.planning_dispatches dispatch where dispatch.id = new.source_id and dispatch.organization_id = new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type = 'dispatch_challenge_open' then
    if not exists (select 1 from public.planning_dispatch_acknowledgements acknowledgement where acknowledgement.id = new.source_id and acknowledgement.organization_id = new.organization_id and acknowledgement.state = 'challenged')
      then raise exception 'attention source dispatch challenge organization mismatch'; end if;
  elsif new.source_type = 'job_parking_review' then
    if not exists (select 1 from public.jobs job where job.id = new.source_id and job.organization_id = new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  elsif new.source_type = 'work_blocker_review' then
    if not exists (select 1 from public.work_blockers blocker where blocker.id = new.source_id and blocker.organization_id = new.organization_id)
      then raise exception 'attention source work blocker organization mismatch'; end if;
  elsif new.source_type in ('work_artifact_review', 'work_artifact_correction', 'work_defect_due') then
    if not exists (select 1 from public.work_artifacts artifact where artifact.id = new.source_id and artifact.organization_id = new.organization_id)
      then raise exception 'attention source work artifact organization mismatch'; end if;
  elsif new.source_type = 'work_handover_review' then
    if not exists (
      select 1 from public.work_handover_packages package
      where package.id = new.source_id and package.organization_id = new.organization_id
      union all
      select 1 from public.jobs job
      where job.id = new.source_id and job.organization_id = new.organization_id
      union all
      select 1 from public.projects project
      where project.id = new.source_id and project.organization_id = new.organization_id
    ) then raise exception 'attention source work handover organization mismatch'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) to service_role;
revoke all on function app_private.validate_attention_source_org()
from public, anon, authenticated;
grant execute on function app_private.validate_attention_source_org()
to postgres, service_role;
