create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_incomplete_required integer;
  v_reopened_predecessors integer;
  v_open_blockers integer;
  v_open_start_dependencies integer;
  v_open_completion_dependencies integer;
  v_active_clock integer := 0;
  v_incomplete_project_children integer := 0;
begin
  select count(*) into v_incomplete_required
  from public.job_instruction_items i
  where i.organization_id = p_organization_id
    and ((p_job_id is not null and i.job_id = p_job_id)
      or (p_project_id is not null and i.project_id = p_project_id))
    and i.requirement_state = 'required' and not i.is_completed;

  select count(*) into v_reopened_predecessors
  from public.job_instruction_item_dependencies d
  join public.job_instruction_items dependent on dependent.id = d.dependent_item_id
  join public.job_instruction_items predecessor on predecessor.id = d.predecessor_item_id
  where d.organization_id = p_organization_id
    and dependent.is_completed and not predecessor.is_completed
    and ((p_job_id is not null and dependent.job_id = p_job_id)
      or (p_project_id is not null and dependent.project_id = p_project_id));

  select count(*) into v_open_blockers
  from public.work_blockers b
  where b.organization_id = p_organization_id and b.state = 'open'
    and (
      (p_job_id is not null and (b.job_id = p_job_id or b.instruction_item_id in (
        select i.id from public.job_instruction_items i where i.job_id = p_job_id
      )))
      or (p_project_id is not null and (b.project_id = p_project_id or b.instruction_item_id in (
        select i.id from public.job_instruction_items i where i.project_id = p_project_id
      )))
    );

  select count(*) filter (
      where d.effect = 'blocks_start' and not app_private.work_dependency_is_satisfied(d.id)
    ), count(*) filter (
      where d.effect = 'blocks_completion' and not app_private.work_dependency_is_satisfied(d.id)
    )
  into v_open_start_dependencies, v_open_completion_dependencies
  from public.work_dependencies d
  where d.organization_id = p_organization_id and d.removed_at is null
    and ((p_job_id is not null and d.dependent_job_id = p_job_id)
      or (p_project_id is not null and d.dependent_project_id = p_project_id));

  if p_job_id is not null then
    select count(*) into v_active_clock from (
      select distinct on (t.user_id) t.entry_type, t.job_id
      from public.time_entries t
      where t.organization_id = p_organization_id
        and t.timestamp >= (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
        and t.status not in ('rejected', 'pending_delete')
      order by t.user_id, t.timestamp desc
    ) latest
    where latest.entry_type in ('clock_in', 'break_end') and latest.job_id = p_job_id;
  end if;

  if p_project_id is not null then
    select count(*) into v_incomplete_project_children
    from public.jobs j
    where j.organization_id = p_organization_id and j.project_id = p_project_id
      and coalesce(j.execution_state, app_private.resolve_legacy_job_execution_state(j.status))
        not in ('execution_complete', 'handed_over', 'cancelled');
  end if;

  return jsonb_build_object(
    'incompleteRequiredInstructions', v_incomplete_required,
    'reopenedInstructionPredecessors', v_reopened_predecessors,
    'openBlockers', v_open_blockers,
    'openStartDependencies', v_open_start_dependencies,
    'openCompletionDependencies', v_open_completion_dependencies,
    'activeJobClocks', v_active_clock,
    'incompleteProjectChildren', v_incomplete_project_children,
    'notAssessable', jsonb_build_array(
      'time_segment_completeness', 'material_consumption', 'measurements',
      'defects', 'formal_approvals', 'instruction_evidence',
      'customer_decision', 'signature', 'handover_package', 'tool_custody'
    )
  );
end;
$$;

revoke all on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
to service_role;

create or replace function app_private.transition_work_on_time_start()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job public.jobs%rowtype;
  v_state public.work_execution_state;
begin
  if new.job_id is null or new.entry_type not in ('clock_in', 'break_end')
    or new.status in ('rejected', 'pending_delete')
  then return new; end if;
  select * into v_job from public.jobs j
  where j.id = new.job_id and j.organization_id = new.organization_id
  for update;
  if not found then raise exception 'work_time_start_job_not_found'; end if;
  v_state := coalesce(
    v_job.execution_state,
    app_private.resolve_legacy_job_execution_state(v_job.status)
  );
  if v_state in ('execution_complete', 'handed_over', 'cancelled') then
    raise exception 'work_time_start_terminal';
  end if;
  if v_state in ('not_started', 'interrupted') then
    perform public.transition_work_execution(
      new.organization_id,
      new.user_id,
      'job',
      new.job_id,
      v_job.execution_version,
      'in_progress',
      null,
      false
    );
  end if;
  return new;
end;
$$;

create trigger transition_work_on_time_start
after insert on public.time_entries
for each row execute function app_private.transition_work_on_time_start();

revoke all on function app_private.transition_work_on_time_start()
from public, anon, authenticated;
grant execute on function app_private.transition_work_on_time_start()
to postgres, service_role;
