create or replace function app_private.guard_instruction_evidence_fulfillment_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'instruction_evidence_direct_delete_forbidden';
  end if;
  if coalesce(current_setting('app.instruction_evidence_write', true), '') <> 'true'
  then raise exception 'instruction_evidence_direct_write_forbidden'; end if;
  perform set_config('app.instruction_evidence_write', 'false', true);
  return new;
end;
$$;

drop trigger if exists job_instruction_evidence_fulfillments_guard
  on public.job_instruction_item_evidence_fulfillments;
create trigger job_instruction_evidence_fulfillments_guard
before update or delete on public.job_instruction_item_evidence_fulfillments
for each row execute function app_private.guard_instruction_evidence_fulfillment_write();

create or replace function app_private.guard_work_artifact_manager_action()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided'
  then raise exception 'work_artifact_is_voided'; end if;
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
    if exists (select 1 from public.work_artifact_revisions revision
      where revision.id = new.revision_id and revision.created_by = new.created_by)
    then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not app_private.work_artifact_actor_can_approve(new.organization_id, new.created_by)
    then raise exception 'work_artifact_not_responsible'; end if;
  end if;
  if new.action_type = 'review_withdrawn'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and not exists (select 1 from public.work_artifact_actions action
      where action.revision_id = new.revision_id and action.action_type = 'review_requested'
        and action.created_by = new.created_by)
  then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
  if new.action_type = 'voided'
    and not app_private.is_work_artifact_manager(new.organization_id, new.created_by)
    and (v_artifact.status <> 'draft' or v_artifact.created_by <> new.created_by
      or exists (select 1 from public.work_artifact_actions action
        where action.artifact_id = new.artifact_id))
  then raise exception 'work_artifact_void_not_authorized'; end if;
  return new;
end;
$$;

create or replace function app_private.work_dependency_is_satisfied(
  p_dependency_id uuid
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dependency public.work_dependencies%rowtype;
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_completed boolean;
begin
  select * into v_dependency from public.work_dependencies dependency
  where dependency.id = p_dependency_id and dependency.removed_at is null;
  if not found then return true; end if;
  if v_dependency.declared_kind is not null and v_dependency.manual_state = 'waived'
  then return true; end if;
  if v_dependency.artifact_approval_action_id is not null then
    return exists (
      select 1 from public.work_artifact_actions action
      join public.work_artifacts artifact on artifact.id = action.artifact_id
      where action.id = v_dependency.artifact_approval_action_id
        and action.action_type = 'internal_approved'
        and action.revision_id = artifact.current_revision_id
        and artifact.status = 'approved'
        and artifact.organization_id = v_dependency.organization_id
    );
  end if;
  if v_dependency.declared_kind is not null then
    return v_dependency.manual_state in ('satisfied', 'waived');
  end if;
  if v_dependency.predecessor_instruction_item_id is not null then
    select item.is_completed into v_completed from public.job_instruction_items item
    where item.id = v_dependency.predecessor_instruction_item_id
      and item.organization_id = v_dependency.organization_id;
    return coalesce(v_completed, false);
  end if;
  if v_dependency.predecessor_job_id is not null then
    select * into v_job from public.jobs job
    where job.id = v_dependency.predecessor_job_id
      and job.organization_id = v_dependency.organization_id;
    if not found then return false; end if;
    return coalesce(v_job.execution_state, app_private.resolve_legacy_job_execution_state(v_job.status))
      in ('execution_complete', 'handed_over');
  end if;
  select * into v_project from public.projects project
  where project.id = v_dependency.predecessor_project_id
    and project.organization_id = v_dependency.organization_id;
  if not found then return false; end if;
  return coalesce(v_project.execution_state_override,
    app_private.resolve_legacy_project_execution_state(v_project.status_override))
    in ('execution_complete', 'handed_over');
end;
$$;
