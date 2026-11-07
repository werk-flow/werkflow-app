-- The assigned employee ticks or unticks a checklist item only while its job
-- is open. Finished, handed over or cancelled work keeps its checklist, as the
-- field work pack shows it (isFieldWorkPackReadOnly); Admin and Büro still
-- correct it. Same signature, grants unchanged.
create or replace function public.set_instruction_item_completion(
  p_organization_id uuid,
  p_actor_id uuid,
  p_instruction_item_id uuid,
  p_expected_version bigint,
  p_is_completed boolean
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item public.job_instruction_items%rowtype;
  v_is_manager boolean;
  v_job_state public.work_execution_state;
  v_next_version bigint;
begin
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) into v_is_manager;
  select * into v_item from public.job_instruction_items i
  where i.id = p_instruction_item_id and i.organization_id = p_organization_id
  for update;
  if not found then raise exception 'instruction_item_not_found'; end if;
  if not v_is_manager then
    if v_item.job_id is null or not exists (
      select 1 from public.job_assignments a
      where a.job_id = v_item.job_id and a.user_id = p_actor_id
    ) then raise exception 'instruction_item_not_authorized'; end if;
    -- The share lock waits for a running lifecycle transition, so a tick
    -- never lands after the job was finished.
    select coalesce(j.execution_state, app_private.resolve_legacy_job_execution_state(j.status))
    into v_job_state
    from public.jobs j
    where j.id = v_item.job_id and j.organization_id = p_organization_id
    for share;
    if v_job_state is null
      or v_job_state in ('execution_complete', 'handed_over', 'cancelled')
    then raise exception 'instruction_item_not_authorized'; end if;
  end if;
  if v_item.completion_version <> p_expected_version then
    raise exception 'instruction_item_stale_version';
  end if;
  if v_item.is_completed = p_is_completed then return v_item.completion_version; end if;
  if p_is_completed and exists (
    select 1
    from public.job_instruction_item_dependencies d
    join public.job_instruction_items predecessor
      on predecessor.id = d.predecessor_item_id
    where d.dependent_item_id = v_item.id and not predecessor.is_completed
  ) then raise exception 'instruction_predecessor_incomplete'; end if;
  v_next_version := v_item.completion_version + 1;
  perform set_config('app.work_instruction_completion_write', 'true', true);
  update public.job_instruction_items set
    is_completed = p_is_completed,
    completion_version = v_next_version,
    last_status_changed_by = p_actor_id,
    last_status_changed_at = now(),
    updated_at = now()
  where id = v_item.id;
  insert into public.job_instruction_item_events (
    organization_id, instruction_item_id, event_type,
    previous_version, resulting_version, created_by
  ) values (
    p_organization_id, v_item.id,
    case when p_is_completed then 'completed' else 'reopened' end,
    v_item.completion_version, v_next_version, p_actor_id
  );
  return v_next_version;
end;
$$;
