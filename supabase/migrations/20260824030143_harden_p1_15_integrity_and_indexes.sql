create index work_artifacts_current_revision_org_idx
  on public.work_artifacts(current_revision_id, organization_id)
  where current_revision_id is not null;
create index work_artifact_revisions_org_idx
  on public.work_artifact_revisions(organization_id);
create index work_artifact_revisions_artifact_org_idx
  on public.work_artifact_revisions(artifact_id, organization_id);
create index work_artifact_measurement_lines_revision_org_idx
  on public.work_artifact_measurement_lines(revision_id, organization_id);
create index work_artifact_defect_details_revision_org_idx
  on public.work_artifact_defect_details(revision_id, organization_id);
create index work_artifact_change_details_revision_org_idx
  on public.work_artifact_change_details(revision_id, organization_id);
create index work_artifact_revision_documents_revision_org_idx
  on public.work_artifact_revision_documents(revision_id, organization_id);
create index work_artifact_revision_sources_revision_org_idx
  on public.work_artifact_revision_sources(revision_id, organization_id);
create index work_artifact_revision_sources_time_entry_idx
  on public.work_artifact_revision_sources(time_entry_id) where time_entry_id is not null;
create index work_artifact_revision_sources_inventory_movement_idx
  on public.work_artifact_revision_sources(inventory_movement_id)
  where inventory_movement_id is not null;
create index work_artifact_actions_artifact_org_idx
  on public.work_artifact_actions(artifact_id, organization_id);
create index work_artifact_actions_revision_org_idx
  on public.work_artifact_actions(revision_id, organization_id);
create index job_instruction_evidence_fulfillments_revision_org_idx
  on public.job_instruction_item_evidence_fulfillments(artifact_revision_id, organization_id)
  where artifact_revision_id is not null;

alter table public.work_artifact_actions
  add constraint work_artifact_actions_responsibility_snapshot_check check (
    action_type not in ('internal_approved', 'internal_rejected', 'correction_requested')
    or (responsibility_snapshot is not null and jsonb_typeof(responsibility_snapshot) = 'object')
  );

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

revoke all on function app_private.work_artifact_actor_can_approve(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.work_artifact_actor_can_approve(uuid, uuid) to service_role;
