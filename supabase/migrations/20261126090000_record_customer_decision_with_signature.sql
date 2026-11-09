-- The customer's decision on a customer-facing Arbeitsnachweis revision and
-- the signature that goes with it are recorded in one save
-- (werk-flow/werkflow-planning#157). Before, the decision and the signature
-- were two separate saves, and the dialog offered the empty form again after
-- each, so a second worker could record the decision twice.
--
-- 1. A revision holds at most one customer decision and one signature. The
--    insert guard refuses a second one with
--    `work_artifact_customer_decision_recorded`. A later decision belongs to a
--    new revision. Existing rows stay; only new inserts are checked. The
--    record function locks the artifact before its insert, so two concurrent
--    saves of the same revision serialize and the second is refused.
-- 2. record_work_artifact_customer_decision records the decision and, when
--    the customer signed, the signature in one call. It runs both inserts
--    through record_work_artifact_action, which keeps every existing check
--    (organization, access, current revision, version, customer visibility,
--    the reserved signature document). A refused signature leaves no decision.
--
-- Expand-only: the previous release records a decision and a signature with
-- two calls, which the guard still accepts once each.

create or replace function app_private.guard_work_artifact_manager_action()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided'
  then raise exception 'work_artifact_is_voided'; end if;
  if new.action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
    and exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id
        and action.action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
    )
  then raise exception 'work_artifact_customer_decision_recorded'; end if;
  if new.action_type = 'signature_captured'
    and exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id and action.action_type = 'signature_captured'
    )
  then raise exception 'work_artifact_customer_decision_recorded'; end if;
  if new.action_type = 'signature_captured' then
    insert into public.work_artifact_revision_documents (
      id, organization_id, revision_id, document_id, relation, description, created_by
    ) values (
      new.id, new.organization_id, new.revision_id, new.signature_document_id,
      'signature_mark', 'Erfasste Unterschrift', new.created_by
    ) on conflict (revision_id, document_id, relation) do nothing;
  end if;
  if new.action_type = 'review_requested'
    and (v_artifact.status not in ('draft', 'rejected', 'correction_requested', 'submitted')
      or (v_artifact.status = 'submitted' and exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = new.revision_id and action.action_type = 'review_requested'
      )))
  then raise exception 'work_artifact_review_state_invalid'; end if;
  if new.action_type in (
    'customer_acknowledged', 'customer_refused', 'customer_reserved',
    'signature_captured', 'exported'
  ) and not app_private.can_access_work_artifact_target(
    new.organization_id, v_artifact.job_id, v_artifact.project_id, new.created_by
  ) then raise exception 'work_artifact_not_authorized'; end if;
  if new.action_type in ('internal_approved', 'internal_rejected', 'correction_requested') then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    if exists (
      select 1 from public.work_artifact_revisions revision
      where revision.id = new.revision_id and revision.created_by = new.created_by
    ) then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not app_private.work_artifact_actor_can_approve(new.organization_id, new.created_by)
    then raise exception 'work_artifact_not_responsible'; end if;
  end if;
  if new.action_type = 'review_withdrawn'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and not exists (
      select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id and action.action_type = 'review_requested'
        and action.created_by = new.created_by
    ) then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
  if new.action_type = 'voided'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and (v_artifact.status <> 'draft' or v_artifact.created_by <> new.created_by
      or exists (
        select 1 from public.work_artifact_actions action
        where action.artifact_id = new.artifact_id
      ))
  then raise exception 'work_artifact_void_not_authorized'; end if;
  return new;
end;
$$;

-- The decision and its optional signature: both action ids are the caller's
-- idempotency keys, so a repeated call with the same ids returns the recorded
-- result. The signature action reuses the decision's signer context.
create function public.record_work_artifact_customer_decision(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_decision_action_id uuid,
  p_decision public.work_artifact_action_type,
  p_reason text,
  p_customer_context jsonb,
  p_signature_action_id uuid,
  p_signature_document_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_decision jsonb;
begin
  if p_decision not in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
    or (p_signature_action_id is null) <> (p_signature_document_id is null)
    or p_signature_action_id = p_decision_action_id
  then raise exception 'invalid_input'; end if;
  v_decision := public.record_work_artifact_action(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_decision_action_id,
    p_expected_version, p_decision, p_reason, null, null, p_customer_context, null
  );
  if p_signature_action_id is null then return v_decision; end if;
  return public.record_work_artifact_action(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_signature_action_id,
    (v_decision->>'version')::bigint, 'signature_captured', null, null, null,
    p_customer_context, p_signature_document_id
  );
end;
$$;

revoke all on function public.record_work_artifact_customer_decision(
  uuid, uuid, uuid, uuid, bigint, uuid, public.work_artifact_action_type, text, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.record_work_artifact_customer_decision(
  uuid, uuid, uuid, uuid, bigint, uuid, public.work_artifact_action_type, text, jsonb, uuid, uuid
) to service_role;
