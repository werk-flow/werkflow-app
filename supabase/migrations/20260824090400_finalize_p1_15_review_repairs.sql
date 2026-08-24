create or replace function app_private.validate_work_artifact_detail()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_required_kind public.work_artifact_kind;
  v_responsible_employee_record_id uuid;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_detail_revision_mismatch'; end if;
  v_required_kind := case tg_table_name
    when 'work_artifact_measurement_lines' then 'measurement'::public.work_artifact_kind
    when 'work_artifact_defect_details' then 'defect'::public.work_artifact_kind
    when 'work_artifact_change_details' then 'change_work'::public.work_artifact_kind
    else null
  end;
  if v_required_kind is null or v_revision.kind is distinct from v_required_kind
  then raise exception 'work_artifact_detail_kind_mismatch'; end if;

  if tg_table_name = 'work_artifact_defect_details' then
    v_responsible_employee_record_id := nullif(
      to_jsonb(new)->>'responsible_employee_record_id', ''
    )::uuid;
    if v_responsible_employee_record_id is not null and not exists (
      select 1 from public.employee_records employee
      where employee.id = v_responsible_employee_record_id
        and employee.organization_id = new.organization_id
    ) then raise exception 'work_artifact_defect_responsible_org_mismatch'; end if;
  end if;
  return new;
end;
$$;

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

drop policy if exists "Managers or capturing actors can view work artifact actions"
  on public.work_artifact_actions;
create policy "Managers or capturing actors can view work artifact actions"
on public.work_artifact_actions for select to authenticated
using (
  app_private.is_work_artifact_manager(organization_id, (select auth.uid()))
  or created_by = (select auth.uid())
  or exists (
    select 1 from public.work_artifacts artifact
    where artifact.id = work_artifact_actions.artifact_id
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, (select auth.uid())
      )
  )
);
