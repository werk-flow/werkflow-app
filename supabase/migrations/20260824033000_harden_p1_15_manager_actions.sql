create or replace function app_private.guard_work_artifact_manager_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_not_found'; end if;

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

create trigger work_artifact_actions_manager_guard
before insert on public.work_artifact_actions
for each row execute function app_private.guard_work_artifact_manager_action();

revoke all on function app_private.guard_work_artifact_manager_action()
from public, anon, authenticated;
grant execute on function app_private.guard_work_artifact_manager_action()
to postgres, service_role;
