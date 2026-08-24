create or replace function app_private.work_artifact_actor_can_approve(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  with latest_configuration as (
    select configuration.id, configuration.mode
    from public.organization_responsibility_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.responsibility = 'work_artifact_approval'
      and configuration.effective_from <= now()
    order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
    limit 1
  ), actor as (
    select member.role, employee.id as employee_record_id
    from public.organization_members member
    left join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
     and employee.exit_date is null
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ), directly_authorized as (
    select actor.employee_record_id
    from actor left join latest_configuration configuration on true
    where actor.employee_record_id is not null and (
      ((configuration.id is null or configuration.mode = 'role_default')
        and actor.role in ('admin', 'buero'))
      or (configuration.mode = 'selected' and exists (
        select 1 from public.organization_responsibility_assignments assignment
        where assignment.configuration_id = configuration.id
          and assignment.employee_record_id = actor.employee_record_id
      ))
    )
  ), delegated_authorized as (
    select delegation.substitute_employee_record_id
    from public.organization_responsibility_delegations delegation
    join actor on actor.employee_record_id = delegation.substitute_employee_record_id
    left join latest_configuration configuration on true
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'work_artifact_approval'
      and delegation.valid_from <= (now() at time zone 'Europe/Berlin')::date
      and delegation.valid_until >= (now() at time zone 'Europe/Berlin')::date
      and (delegation.revoked_from is null
        or delegation.revoked_from > (now() at time zone 'Europe/Berlin')::date)
      and (
        ((configuration.id is null or configuration.mode = 'role_default') and exists (
          select 1
          from public.employee_records delegator
          join public.organization_members member
            on member.organization_id = delegator.organization_id
           and member.user_id = delegator.user_id
          where delegator.id = delegation.delegator_employee_record_id
            and delegator.exit_date is null and member.role in ('admin', 'buero')
        ))
        or (configuration.mode = 'selected' and exists (
          select 1 from public.organization_responsibility_assignments assignment
          where assignment.configuration_id = configuration.id
            and assignment.employee_record_id = delegation.delegator_employee_record_id
        ))
      )
  )
  select exists (select 1 from directly_authorized)
    or exists (select 1 from delegated_authorized);
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
      or exists (
        select 1 from public.work_artifact_actions action
        where action.artifact_id = new.artifact_id
      ))
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
      select 1
      from public.work_artifact_actions action
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
    select * into v_job from public.jobs job where job.id = v_dependency.predecessor_job_id
      and job.organization_id = v_dependency.organization_id;
    if not found then return false; end if;
    return coalesce(v_job.execution_state, app_private.resolve_legacy_job_execution_state(v_job.status))
      in ('execution_complete', 'handed_over');
  end if;
  select * into v_project from public.projects project
  where project.id = v_dependency.predecessor_project_id
    and project.organization_id = v_dependency.organization_id;
  if not found then return false; end if;
  return coalesce(
    v_project.execution_state_override,
    app_private.resolve_legacy_project_execution_state(v_project.status_override)
  ) in ('execution_complete', 'handed_over');
end;
$$;

alter function app_private.can_access_document(uuid, uuid) stable;

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
  v_responsible_employee_record_id := nullif(
    to_jsonb(new)->>'responsible_employee_record_id', ''
  )::uuid;
  if tg_table_name = 'work_artifact_defect_details'
    and v_responsible_employee_record_id is not null and not exists (
      select 1 from public.employee_records employee
      where employee.id = v_responsible_employee_record_id
        and employee.organization_id = new.organization_id
    ) then raise exception 'work_artifact_defect_responsible_org_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_artifact_relation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_revision_mismatch'; end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = v_revision.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_artifact_mismatch'; end if;

  if tg_table_name = 'work_artifact_revision_documents' then
    if not exists (
      select 1 from public.documents document
      join public.document_links link on link.document_id = document.id
      where document.id = new.document_id and document.organization_id = new.organization_id
        and document.deleted_at is null
        and ((v_artifact.job_id is not null and link.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and link.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_document_target_mismatch'; end if;
  elsif tg_table_name = 'work_artifact_revision_sources' then
    if new.time_entry_id is not null and not exists (
      select 1 from public.time_entries entry
      left join public.jobs job on job.id = entry.job_id
      where entry.id = new.time_entry_id and entry.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and entry.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and job.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_time_source_target_mismatch'; end if;
    if new.inventory_movement_id is not null and not exists (
      select 1 from public.inventory_movements movement
      left join public.jobs job on job.id = movement.job_id
      where movement.id = new.inventory_movement_id
        and movement.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and movement.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null
            and (movement.project_id = v_artifact.project_id or job.project_id = v_artifact.project_id)))
    ) then raise exception 'work_artifact_inventory_source_target_mismatch'; end if;
  else
    raise exception 'work_artifact_relation_table_invalid';
  end if;
  return new;
end;
$$;
