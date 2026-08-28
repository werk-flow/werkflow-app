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
