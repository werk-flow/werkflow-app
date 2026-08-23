create or replace function app_private.resolve_project_execution_state(
  p_project_id uuid
)
returns public.work_execution_state
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_project public.projects%rowtype;
  v_total integer;
  v_not_started integer;
  v_in_progress integer;
  v_interrupted integer;
  v_complete integer;
  v_handed_over integer;
  v_cancelled integer;
begin
  select * into v_project from public.projects p where p.id = p_project_id;
  if not found then return null; end if;
  if v_project.execution_state_override is not null then
    return v_project.execution_state_override;
  end if;
  select
    count(*),
    count(*) filter (where state = 'not_started'),
    count(*) filter (where state = 'in_progress'),
    count(*) filter (where state = 'interrupted'),
    count(*) filter (where state = 'execution_complete'),
    count(*) filter (where state = 'handed_over'),
    count(*) filter (where state = 'cancelled')
  into v_total, v_not_started, v_in_progress, v_interrupted,
    v_complete, v_handed_over, v_cancelled
  from (
    select coalesce(
      j.execution_state,
      app_private.resolve_legacy_job_execution_state(j.status)
    ) as state
    from public.jobs j where j.project_id = p_project_id
  ) child;
  if v_total = 0 then
    return app_private.resolve_legacy_project_execution_state(v_project.status_override);
  elsif v_handed_over = v_total then return 'handed_over';
  elsif v_cancelled = v_total then return 'cancelled';
  elsif v_complete + v_handed_over + v_cancelled = v_total then return 'execution_complete';
  elsif v_in_progress > 0 or v_complete > 0 or v_handed_over > 0 then return 'in_progress';
  elsif v_interrupted > 0 then return 'interrupted';
  else return 'not_started';
  end if;
end;
$$;

revoke all on function app_private.resolve_project_execution_state(uuid)
from public, anon, authenticated;
grant execute on function app_private.resolve_project_execution_state(uuid)
to service_role;

create or replace function public.get_work_lifecycle_snapshot(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_state public.work_execution_state;
  v_version bigint;
  v_is_legacy boolean;
  v_planned boolean;
  v_gates jsonb;
  v_blockers jsonb;
  v_dependencies jsonb;
  v_history jsonb;
begin
  if p_target_type not in ('job', 'project') then
    raise exception 'work_snapshot_invalid_input';
  end if;
  if p_target_type = 'job' then
    select * into v_job from public.jobs j
    where j.id = p_target_id and j.organization_id = p_organization_id;
    if not found then raise exception 'work_snapshot_target_not_found'; end if;
    if not app_private.can_view_p1_14_work_target(
      p_organization_id, p_target_id, null, null, p_actor_id
    ) then raise exception 'work_snapshot_not_authorized'; end if;
    v_state := coalesce(
      v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status)
    );
    v_version := v_job.execution_version;
    v_is_legacy := v_job.execution_state is null;
    select exists (
      select 1 from public.planning_occurrences o
      where o.organization_id = p_organization_id and o.job_id = p_target_id
        and o.status = 'scheduled'
    ) into v_planned;
    v_gates := app_private.build_work_gate_snapshot(p_organization_id, p_target_id, null);
  else
    select * into v_project from public.projects p
    where p.id = p_target_id and p.organization_id = p_organization_id;
    if not found then raise exception 'work_snapshot_target_not_found'; end if;
    if not app_private.can_view_p1_14_work_target(
      p_organization_id, null, p_target_id, null, p_actor_id
    ) then raise exception 'work_snapshot_not_authorized'; end if;
    v_state := app_private.resolve_project_execution_state(p_target_id);
    v_version := v_project.execution_version;
    v_is_legacy := v_project.execution_state_override is null;
    select exists (
      select 1 from public.planning_occurrences o
      join public.jobs j on j.id = o.job_id
      where o.organization_id = p_organization_id and j.project_id = p_target_id
        and o.status = 'scheduled'
    ) into v_planned;
    v_gates := app_private.build_work_gate_snapshot(p_organization_id, null, p_target_id);
  end if;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]'::jsonb)
  into v_blockers
  from public.work_blockers b
  where b.organization_id = p_organization_id and b.state = 'open'
    and (
      (p_target_type = 'job' and (
        b.job_id = p_target_id or b.instruction_item_id in (
          select i.id from public.job_instruction_items i where i.job_id = p_target_id
        )
      ))
      or (p_target_type = 'project' and (
        b.project_id = p_target_id or b.instruction_item_id in (
          select i.id from public.job_instruction_items i where i.project_id = p_target_id
        )
      ))
    );

  select coalesce(jsonb_agg(
    to_jsonb(d) || jsonb_build_object(
      'is_satisfied', app_private.work_dependency_is_satisfied(d.id)
    ) order by d.created_at
  ), '[]'::jsonb)
  into v_dependencies
  from public.work_dependencies d
  where d.organization_id = p_organization_id and d.removed_at is null
    and (
      (p_target_type = 'job' and d.dependent_job_id = p_target_id)
      or (p_target_type = 'project' and d.dependent_project_id = p_target_id)
    );

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.work_execution_events e
    where e.organization_id = p_organization_id and (
      (p_target_type = 'job' and e.job_id = p_target_id)
      or (p_target_type = 'project' and e.project_id = p_target_id)
    )
    order by e.created_at desc limit 25
  ) e;

  return jsonb_build_object(
    'targetType', p_target_type,
    'targetId', p_target_id,
    'executionState', v_state,
    'executionVersion', v_version,
    'isLegacy', v_is_legacy,
    'isPlanned', v_planned,
    'gates', v_gates,
    'blockers', v_blockers,
    'dependencies', v_dependencies,
    'history', v_history
  );
end;
$$;

revoke all on function public.get_work_lifecycle_snapshot(uuid, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.get_work_lifecycle_snapshot(uuid, uuid, text, uuid)
to service_role;
