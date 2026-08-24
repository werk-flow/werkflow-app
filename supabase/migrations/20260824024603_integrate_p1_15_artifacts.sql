alter table public.work_dependencies
  add column artifact_approval_action_id uuid references public.work_artifact_actions(id) on delete restrict;
create index work_dependencies_artifact_approval_action_idx
  on public.work_dependencies(artifact_approval_action_id)
  where artifact_approval_action_id is not null;
alter table public.work_dependencies
  add constraint work_dependencies_artifact_approval_check check (
    artifact_approval_action_id is null or declared_kind = 'approval'
  );

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

  if v_dependency.declared_kind is not null
    and v_dependency.manual_state = 'waived'
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

create or replace function public.link_work_dependency_artifact_approval(
  p_organization_id uuid,
  p_actor_id uuid,
  p_dependency_id uuid,
  p_expected_version bigint,
  p_action_id uuid,
  p_reason text
)
returns public.work_dependencies language plpgsql security definer set search_path = ''
as $$
declare
  v_dependency public.work_dependencies%rowtype;
  v_action public.work_artifact_actions%rowtype;
  v_artifact public.work_artifacts%rowtype;
  v_result public.work_dependencies%rowtype;
begin
  if not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
  then raise exception 'work_dependency_not_authorized'; end if;
  select * into v_dependency from public.work_dependencies dependency
  where dependency.id = p_dependency_id and dependency.organization_id = p_organization_id
  for update;
  if not found or v_dependency.declared_kind <> 'approval' or v_dependency.removed_at is not null
  then raise exception 'work_dependency_approval_not_found'; end if;
  if v_dependency.version is distinct from p_expected_version
  then raise exception 'work_dependency_stale_version'; end if;
  select * into v_action from public.work_artifact_actions action
  where action.id = p_action_id and action.organization_id = p_organization_id
    and action.action_type = 'internal_approved';
  if not found then raise exception 'work_dependency_approval_action_invalid'; end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = v_action.artifact_id and artifact.current_revision_id = v_action.revision_id
    and artifact.status = 'approved';
  if not found or not (
    (v_dependency.dependent_job_id is not null and v_artifact.job_id = v_dependency.dependent_job_id)
    or (v_dependency.dependent_project_id is not null and v_artifact.project_id = v_dependency.dependent_project_id)
  ) then raise exception 'work_dependency_approval_target_mismatch'; end if;

  update public.work_dependencies set artifact_approval_action_id = p_action_id,
    manual_state = 'satisfied', version = version + 1, updated_at = now(), updated_by = p_actor_id
  where id = p_dependency_id returning * into v_result;
  insert into public.work_dependency_events (
    organization_id, dependency_id, event_type, reason, after_state, created_by
  ) values (
    p_organization_id, p_dependency_id, 'satisfied', nullif(btrim(p_reason), ''),
    jsonb_build_object('artifactApprovalActionId', p_action_id, 'version', v_result.version), p_actor_id
  );
  return v_result;
end;
$$;

create or replace function app_private.can_access_document(p_document_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.documents document
    where document.id = p_document_id and document.deleted_at is null
      and app_private.is_document_manager(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    join public.job_assignments assignment on assignment.job_id = link.job_id
    where document.id = p_document_id and document.deleted_at is null
      and link.job_id is not null and assignment.user_id = p_user_id
  ) or exists (
    select 1
    from public.documents document
    join public.work_artifact_revision_documents relation on relation.document_id = document.id
    join public.work_artifact_revisions revision on revision.id = relation.revision_id
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where document.id = p_document_id and document.deleted_at is null
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, p_user_id
      )
  );
$$;

create or replace function app_private.prevent_historic_work_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;

  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events event where event.job_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.job_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_job_id = old.id or dependency.predecessor_job_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.job_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events event where event.project_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.project_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_project_id = old.id or dependency.predecessor_project_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.project_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  return old;
end;
$$;

create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_incomplete_required integer;
  v_reopened_predecessors integer;
  v_open_blockers integer;
  v_open_start_dependencies integer;
  v_open_completion_dependencies integer;
  v_active_clock integer := 0;
  v_incomplete_project_children integer := 0;
  v_incomplete_instruction_evidence integer := 0;
  v_measurement_artifacts integer := 0;
  v_open_defects integer := 0;
  v_pending_formal_approvals integer := 0;
  v_required_customer_decisions integer := 0;
  v_required_signatures integer := 0;
  v_artifact_facts jsonb := '[]'::jsonb;
  v_not_assessable jsonb := jsonb_build_array(
    'time_segment_completeness', 'material_consumption', 'handover_package', 'tool_custody'
  );
begin
  select count(*) into v_incomplete_required
  from public.job_instruction_items item
  where item.organization_id = p_organization_id
    and ((p_job_id is not null and item.job_id = p_job_id)
      or (p_project_id is not null and item.project_id = p_project_id))
    and item.requirement_state = 'required' and not item.is_completed;

  select count(*) into v_reopened_predecessors
  from public.job_instruction_item_dependencies dependency
  join public.job_instruction_items dependent on dependent.id = dependency.dependent_item_id
  join public.job_instruction_items predecessor on predecessor.id = dependency.predecessor_item_id
  where dependency.organization_id = p_organization_id
    and dependent.is_completed and not predecessor.is_completed
    and ((p_job_id is not null and dependent.job_id = p_job_id)
      or (p_project_id is not null and dependent.project_id = p_project_id));

  select count(*) into v_incomplete_instruction_evidence
  from public.job_instruction_item_evidence_requirements requirement
  join public.job_instruction_items item on item.id = requirement.instruction_item_id
  where requirement.organization_id = p_organization_id
    and item.requirement_state = 'required'
    and ((p_job_id is not null and item.job_id = p_job_id)
      or (p_project_id is not null and item.project_id = p_project_id))
    and not exists (
      select 1 from public.job_instruction_item_evidence_fulfillments fulfillment
      where fulfillment.evidence_requirement_id = requirement.id and fulfillment.removed_at is null
    );

  select count(*) into v_open_blockers
  from public.work_blockers blocker
  where blocker.organization_id = p_organization_id and blocker.state = 'open'
    and (
      (p_job_id is not null and (blocker.job_id = p_job_id or blocker.instruction_item_id in (
        select item.id from public.job_instruction_items item where item.job_id = p_job_id
      )))
      or (p_project_id is not null and (blocker.project_id = p_project_id or blocker.instruction_item_id in (
        select item.id from public.job_instruction_items item where item.project_id = p_project_id
      )))
    );

  select count(*) filter (
      where dependency.effect = 'blocks_start'
        and not app_private.work_dependency_is_satisfied(dependency.id)
    ), count(*) filter (
      where dependency.effect = 'blocks_completion'
        and not app_private.work_dependency_is_satisfied(dependency.id)
    )
  into v_open_start_dependencies, v_open_completion_dependencies
  from public.work_dependencies dependency
  where dependency.organization_id = p_organization_id and dependency.removed_at is null
    and ((p_job_id is not null and dependency.dependent_job_id = p_job_id)
      or (p_project_id is not null and dependency.dependent_project_id = p_project_id));

  if p_job_id is not null then
    select count(*) into v_active_clock from (
      select distinct on (entry.user_id) entry.entry_type, entry.job_id
      from public.time_entries entry
      where entry.organization_id = p_organization_id
        and entry.status not in ('rejected', 'pending_delete')
      order by entry.user_id, entry.timestamp desc
    ) latest
    where latest.entry_type in ('clock_in', 'break_end') and latest.job_id = p_job_id;
  end if;

  if p_project_id is not null then
    select count(*) into v_incomplete_project_children
    from public.jobs job
    where job.organization_id = p_organization_id and job.project_id = p_project_id
      and coalesce(job.execution_state, app_private.resolve_legacy_job_execution_state(job.status))
        not in ('execution_complete', 'handed_over', 'cancelled');
  end if;

  with current_artifacts as (
    select artifact.*, revision.visibility, revision.requires_customer_response,
      revision.requires_signature
    from public.work_artifacts artifact
    join public.work_artifact_revisions revision on revision.id = artifact.current_revision_id
    where artifact.organization_id = p_organization_id and artifact.status <> 'voided'
      and ((p_job_id is not null and artifact.job_id = p_job_id)
        or (p_project_id is not null and artifact.project_id = p_project_id))
  )
  select
    count(*) filter (where current.kind = 'measurement'),
    count(*) filter (
      where current.kind = 'defect' and exists (
        select 1 from public.work_artifact_defect_details detail
        where detail.revision_id = current.current_revision_id and detail.state <> 'resolved'
      )
    ),
    count(*) filter (where current.status in ('submitted', 'correction_requested')),
    count(*) filter (
      where current.requires_customer_response and not exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = current.current_revision_id
          and action.action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved')
      )
    ),
    count(*) filter (
      where current.requires_signature and not exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = current.current_revision_id
          and action.action_type = 'signature_captured'
      )
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'artifactId', current.id, 'version', current.version,
      'revisionId', current.current_revision_id, 'status', current.status,
      'kind', current.kind,
      'latestActionId', (select action.id from public.work_artifact_actions action
        where action.revision_id = current.current_revision_id
        order by action.created_at desc, action.id desc limit 1),
      'defectState', (select detail.state from public.work_artifact_defect_details detail
        where detail.revision_id = current.current_revision_id)
    ) order by current.id), '[]'::jsonb)
  into v_measurement_artifacts, v_open_defects, v_pending_formal_approvals,
    v_required_customer_decisions, v_required_signatures, v_artifact_facts
  from current_artifacts current;

  if v_measurement_artifacts = 0 then
    v_not_assessable := v_not_assessable || jsonb_build_array('measurements');
  end if;
  if not exists (
    select 1 from public.work_artifact_revisions revision
    join public.work_artifacts artifact on artifact.current_revision_id = revision.id
    where artifact.organization_id = p_organization_id and artifact.status <> 'voided'
      and revision.requires_customer_response
      and ((p_job_id is not null and artifact.job_id = p_job_id)
        or (p_project_id is not null and artifact.project_id = p_project_id))
  ) then v_not_assessable := v_not_assessable || jsonb_build_array('customer_decision'); end if;
  if not exists (
    select 1 from public.work_artifact_revisions revision
    join public.work_artifacts artifact on artifact.current_revision_id = revision.id
    where artifact.organization_id = p_organization_id and artifact.status <> 'voided'
      and revision.requires_signature
      and ((p_job_id is not null and artifact.job_id = p_job_id)
        or (p_project_id is not null and artifact.project_id = p_project_id))
  ) then v_not_assessable := v_not_assessable || jsonb_build_array('signature'); end if;

  return jsonb_build_object(
    'incompleteRequiredInstructions', v_incomplete_required,
    'reopenedInstructionPredecessors', v_reopened_predecessors,
    'incompleteInstructionEvidence', v_incomplete_instruction_evidence,
    'openBlockers', v_open_blockers,
    'openStartDependencies', v_open_start_dependencies,
    'openCompletionDependencies', v_open_completion_dependencies,
    'activeJobClocks', v_active_clock,
    'incompleteProjectChildren', v_incomplete_project_children,
    'measurementArtifacts', v_measurement_artifacts,
    'openDefects', v_open_defects,
    'pendingFormalApprovals', v_pending_formal_approvals,
    'requiredCustomerDecisions', v_required_customer_decisions,
    'requiredSignatures', v_required_signatures,
    'artifactFacts', v_artifact_facts,
    'notAssessable', v_not_assessable
  );
end;
$$;

create or replace function public.transition_work_execution(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text default null,
  p_override_gates boolean default false
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.org_role;
  v_is_manager boolean;
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_from_state public.work_execution_state;
  v_snapshot jsonb;
  v_fingerprint text;
  v_event_id uuid;
  v_event_type text := 'transitioned';
  v_next_version bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_legacy_status text;
  v_gates_pass boolean;
begin
  if p_target_type not in ('job', 'project') or p_expected_version < 0
  then raise exception 'work_transition_invalid_input'; end if;
  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id;
  if v_role is null then raise exception 'work_transition_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');

  if p_target_type = 'job' then
    select * into v_job from public.jobs job
    where job.id = p_target_id and job.organization_id = p_organization_id for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if not v_is_manager and not exists (
      select 1 from public.job_assignments assignment
      where assignment.job_id = v_job.id and assignment.user_id = p_actor_id
    ) then raise exception 'work_transition_not_authorized'; end if;
    if v_job.execution_version <> p_expected_version then raise exception 'work_transition_stale_version'; end if;
    v_from_state := coalesce(v_job.execution_state, app_private.resolve_legacy_job_execution_state(v_job.status));
    v_legacy_status := v_job.status::text;
  else
    if not v_is_manager then raise exception 'work_transition_not_authorized'; end if;
    select * into v_project from public.projects project
    where project.id = p_target_id and project.organization_id = p_organization_id for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if v_project.execution_version <> p_expected_version then raise exception 'work_transition_stale_version'; end if;
    v_from_state := coalesce(
      v_project.execution_state_override,
      app_private.resolve_legacy_project_execution_state(v_project.status_override)
    );
    v_legacy_status := coalesce(v_project.status_override::text, 'derived');
  end if;

  if v_from_state = p_to_state then raise exception 'work_transition_same_state'; end if;
  if not (
    (v_from_state = 'not_started' and p_to_state in ('in_progress', 'cancelled'))
    or (v_from_state = 'in_progress' and p_to_state in ('interrupted', 'execution_complete', 'cancelled'))
    or (v_from_state = 'interrupted' and p_to_state in ('in_progress', 'cancelled'))
    or (v_from_state = 'execution_complete' and p_to_state in ('handed_over', 'in_progress'))
    or (v_from_state = 'handed_over' and p_to_state = 'execution_complete')
    or (v_from_state = 'cancelled' and p_to_state = 'not_started')
  ) then raise exception 'work_transition_not_allowed'; end if;

  if not v_is_manager and (
    p_to_state in ('cancelled', 'handed_over')
    or v_from_state in ('execution_complete', 'handed_over', 'cancelled')
    or p_override_gates
  ) then raise exception 'work_transition_not_authorized'; end if;
  if (
    p_to_state in ('interrupted', 'cancelled', 'handed_over')
    or v_from_state in ('execution_complete', 'handed_over', 'cancelled')
    or p_target_type = 'project' or p_override_gates
  ) and (v_reason is null or length(v_reason) not between 3 and 1000)
  then raise exception 'work_transition_reason_required'; end if;

  v_snapshot := app_private.build_work_gate_snapshot(
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end
  );
  v_fingerprint := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  if p_to_state = 'in_progress' then
    v_gates_pass := (v_snapshot->>'openBlockers')::integer = 0
      and (v_snapshot->>'openStartDependencies')::integer = 0;
    if not v_gates_pass then raise exception 'work_transition_start_blocked'; end if;
  elsif p_to_state in ('execution_complete', 'handed_over') then
    v_gates_pass := (v_snapshot->>'incompleteRequiredInstructions')::integer = 0
      and (v_snapshot->>'reopenedInstructionPredecessors')::integer = 0
      and (v_snapshot->>'incompleteInstructionEvidence')::integer = 0
      and (v_snapshot->>'openBlockers')::integer = 0
      and (v_snapshot->>'openCompletionDependencies')::integer = 0
      and (v_snapshot->>'activeJobClocks')::integer = 0
      and (v_snapshot->>'incompleteProjectChildren')::integer = 0;
    if p_to_state = 'handed_over' then
      v_gates_pass := v_gates_pass
        and (v_snapshot->>'requiredCustomerDecisions')::integer = 0
        and (v_snapshot->>'requiredSignatures')::integer = 0;
    end if;
    if not v_gates_pass and not (v_is_manager and p_override_gates)
    then raise exception 'work_transition_completion_blocked'; end if;
  end if;

  v_next_version := p_expected_version + 1;
  perform set_config('app.work_execution_write', 'true', true);
  if p_target_type = 'job' then
    update public.jobs set
      execution_state = p_to_state,
      execution_version = v_next_version,
      status = case
        when p_to_state = 'not_started' and exists (
          select 1 from public.work_blockers blocker
          where blocker.job_id = v_job.id and blocker.kind = 'parking' and blocker.state = 'open'
        ) then 'geparkt'::public.job_status
        when p_to_state = 'not_started' then 'nicht_bearbeitet'::public.job_status
        when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.job_status
        else 'fertig'::public.job_status
      end,
      actual_completion_date = case
        when p_to_state in ('execution_complete', 'handed_over')
          then coalesce(actual_completion_date, (now() at time zone 'Europe/Berlin')::date)
        else null end,
      updated_at = now()
    where id = v_job.id;
  else
    update public.projects set
      execution_state_override = p_to_state,
      execution_version = v_next_version,
      execution_override_reason = v_reason,
      status_override = case
        when p_to_state = 'not_started' then 'nicht_begonnen'::public.project_status
        when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.project_status
        when p_to_state in ('execution_complete', 'handed_over', 'cancelled')
          then 'abgeschlossen'::public.project_status end,
      updated_at = now()
    where id = v_project.id;
  end if;

  v_event_type := case
    when current_setting('app.work_transition_origin', true) = 'automatic_time_start' then 'automatic_time_start'
    when p_to_state = 'cancelled' then 'cancelled'
    when v_from_state = 'cancelled' then 'restored'
    when p_to_state = 'handed_over' then 'handed_over'
    when v_from_state = 'handed_over' then 'handover_withdrawn'
    when v_from_state = 'execution_complete' and p_to_state = 'in_progress' then 'reopened'
    when p_target_type = 'project' then 'override_set'
    else 'transitioned' end;

  insert into public.work_execution_events (
    organization_id, job_id, project_id, event_type, from_state, to_state,
    previous_version, resulting_version, reason, gate_snapshot,
    gate_fingerprint, event_payload, created_by
  ) values (
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end,
    v_event_type, v_from_state, p_to_state, p_expected_version, v_next_version,
    v_reason, v_snapshot, v_fingerprint,
    jsonb_build_object(
      'legacyStatus', v_legacy_status,
      'legacyInitialization', case when p_target_type = 'job'
        then v_job.execution_state is null else v_project.execution_state_override is null end,
      'gateOverride', p_override_gates, 'gatePassed', v_gates_pass
    ), p_actor_id
  ) returning id into v_event_id;
  return query select p_to_state, v_next_version, v_event_id, v_snapshot, v_fingerprint;
end;
$$;

create or replace function public.finalize_work_artifact_export(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_document_id uuid,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_link_result jsonb;
begin
  v_link_result := public.link_work_artifact_document(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_link_id,
    p_expected_version, p_document_id, 'rendered_export',
    'Deterministischer HTML-Export', p_renderer_version, p_content_hash
  );
  return public.record_work_artifact_action(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_action_id,
    (v_link_result->>'version')::bigint, 'exported', null, null,
    null, null, null
  );
end;
$$;

revoke all on function app_private.work_dependency_is_satisfied(uuid)
  from public, anon, authenticated;
grant execute on function app_private.work_dependency_is_satisfied(uuid) to service_role;
revoke all on function app_private.can_access_document(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_access_document(uuid, uuid) to authenticated, service_role;
revoke all on function app_private.prevent_historic_work_delete()
  from public, anon, authenticated;
grant execute on function app_private.prevent_historic_work_delete() to postgres, service_role;
revoke all on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(uuid, uuid, uuid) to service_role;
revoke all on function public.link_work_dependency_artifact_approval(
  uuid, uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.link_work_dependency_artifact_approval(
  uuid, uuid, uuid, bigint, uuid, text
) to service_role;
revoke all on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;
revoke all on function public.finalize_work_artifact_export(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_work_artifact_export(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text
) to service_role;

comment on table public.work_artifacts is
  'P1-15 stable current projection for one job/project field-documentation artifact.';
comment on table public.work_artifact_revisions is
  'P1-15 immutable structured artifact revisions; decisions bind to exact revision IDs.';
comment on table public.work_artifact_actions is
  'P1-15 append-only internal review, customer response, signature, export and void evidence.';
comment on table public.job_instruction_item_evidence_fulfillments is
  'P1-15 deliberate current fulfillment of a P1-13 evidence expectation by one document or artifact revision.';
