-- Restrict the lifecycle-history delete exemption to the organization whose
-- deliberate cascade is currently running. Other trigger-driven deletes keep
-- the same history protection as direct deletes.

create or replace function app_private.mark_organization_cascade_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform set_config('app.deleting_organization_id', old.id::text, true);
  return old;
end;
$$;

drop trigger if exists mark_p1_14_organization_cascade_delete
on public.organizations;
create trigger mark_p1_14_organization_cascade_delete
before delete on public.organizations
for each row execute function app_private.mark_organization_cascade_delete();

revoke all on function app_private.mark_organization_cascade_delete()
from public, anon, authenticated;
grant execute on function app_private.mark_organization_cascade_delete()
to postgres, service_role;

create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if current_setting('app.deleting_organization_id', true) = old.organization_id::text then
    return old;
  end if;

  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events e where e.job_id = old.id)
    or exists (select 1 from public.work_blockers b where b.job_id = old.id)
    or exists (
      select 1 from public.work_dependencies d
      where d.dependent_job_id = old.id or d.predecessor_job_id = old.id
    )
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events e where e.project_id = old.id)
    or exists (select 1 from public.work_blockers b where b.project_id = old.id)
    or exists (
      select 1 from public.work_dependencies d
      where d.dependent_project_id = old.id or d.predecessor_project_id = old.id
    )
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  return old;
end;
$$;

revoke all on function app_private.prevent_historic_work_delete()
from public, anon, authenticated;
grant execute on function app_private.prevent_historic_work_delete()
to postgres, service_role;

-- Restore the legacy project status from the canonical override when unparking.
-- Projects without a canonical override return to automatic child-state derivation.
create or replace function public.unpark_work_target(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_blocker_version bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_blocker public.work_blockers%rowtype;
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next_version bigint;
begin
  if p_target_type not in ('job', 'project')
    or v_reason is null or length(v_reason) not between 3 and 1000
  then raise exception 'work_parking_invalid_input'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_parking_not_authorized'; end if;
  select * into v_blocker from public.work_blockers b
  where b.organization_id = p_organization_id and b.kind = 'parking'
    and b.state = 'open'
    and (
      (p_target_type = 'job' and b.job_id = p_target_id)
      or (p_target_type = 'project' and b.project_id = p_target_id)
    )
  for update;
  if not found then raise exception 'work_parking_context_not_found'; end if;
  if v_blocker.version <> p_expected_blocker_version then
    raise exception 'work_blocker_stale_version';
  end if;
  v_next_version := v_blocker.version + 1;
  update public.work_blockers set
    state = 'resolved', version = v_next_version, updated_by = p_actor_id,
    updated_at = now(), resolved_by = p_actor_id, resolved_at = now(),
    resolution_note = v_reason
  where id = v_blocker.id;
  insert into public.work_blocker_events (
    organization_id, blocker_id, event_type, before_state, after_state, created_by
  ) select p_organization_id, v_blocker.id, 'unparked', to_jsonb(v_blocker),
    to_jsonb(b), p_actor_id from public.work_blockers b where b.id = v_blocker.id;

  if p_target_type = 'job' then
    select * into v_job from public.jobs j
    where j.id = p_target_id and j.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_target_not_found'; end if;
    update public.jobs set
      status = case coalesce(
        v_job.execution_state,
        app_private.resolve_legacy_job_execution_state(v_job.status)
      )
        when 'not_started' then 'nicht_bearbeitet'::public.job_status
        when 'in_progress' then 'in_bearbeitung'::public.job_status
        when 'interrupted' then 'in_bearbeitung'::public.job_status
        else 'fertig'::public.job_status
      end,
      updated_at = now()
    where id = p_target_id;
  else
    select * into v_project from public.projects p
    where p.id = p_target_id and p.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_target_not_found'; end if;
    update public.projects set
      status_override = case v_project.execution_state_override
        when 'not_started' then 'nicht_begonnen'::public.project_status
        when 'in_progress' then 'in_bearbeitung'::public.project_status
        when 'interrupted' then 'in_bearbeitung'::public.project_status
        when 'execution_complete' then 'abgeschlossen'::public.project_status
        when 'handed_over' then 'abgeschlossen'::public.project_status
        when 'cancelled' then 'abgeschlossen'::public.project_status
        else null
      end,
      updated_at = now()
    where id = p_target_id;
  end if;
  return v_next_version;
end;
$$;

revoke all on function public.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
to service_role;
