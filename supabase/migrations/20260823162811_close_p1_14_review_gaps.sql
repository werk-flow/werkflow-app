-- Preserve provenance for child parking rows created by an atomic project park.
alter table public.work_blockers
  add column parent_project_parking_blocker_id uuid
  references public.work_blockers(id) on delete restrict;

create index work_blockers_parent_project_parking_idx
on public.work_blockers(parent_project_parking_blocker_id)
where parent_project_parking_blocker_id is not null;

alter function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) set schema app_private;
alter function app_private.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) rename to park_work_target_base;

revoke all on function app_private.park_work_target_base(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated, service_role;

create function public.park_work_target(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_execution_version bigint,
  p_reason public.work_blocker_reason,
  p_details text,
  p_responsible_employee_record_id uuid,
  p_next_review_date date
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_blocker_id uuid;
begin
  v_blocker_id := app_private.park_work_target_base(
    p_organization_id,
    p_actor_id,
    p_target_type,
    p_target_id,
    p_expected_execution_version,
    p_reason,
    p_details,
    p_responsible_employee_record_id,
    p_next_review_date
  );

  if p_target_type = 'project' then
    update public.work_blockers b set
      parent_project_parking_blocker_id = v_blocker_id
    where b.organization_id = p_organization_id
      and b.kind = 'parking'
      and b.state = 'open'
      and b.parent_project_parking_blocker_id is null
      and b.created_by = p_actor_id
      and b.created_at = transaction_timestamp()
      and b.reason = p_reason
      and b.responsible_employee_record_id = p_responsible_employee_record_id
      and b.next_review_date = p_next_review_date
      and b.job_id in (
        select j.id from public.jobs j
        where j.organization_id = p_organization_id
          and j.project_id = p_target_id
      );
  end if;

  return v_blocker_id;
end;
$$;

revoke all on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) to service_role;

-- A cancellation is not completion. Keep the legacy projection unchanged while
-- the canonical lifecycle records the cancellation and its reason.
create or replace function app_private.preserve_legacy_status_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_table_name = 'jobs'
    and new.execution_state = 'cancelled'
    and old.execution_state is distinct from 'cancelled'
  then
    new.status := old.status;
  elsif tg_table_name = 'projects'
    and new.execution_state_override = 'cancelled'
    and old.execution_state_override is distinct from 'cancelled'
  then
    new.status_override := old.status_override;
  end if;
  return new;
end;
$$;

create trigger preserve_job_legacy_status_on_cancellation
before update of execution_state, status on public.jobs
for each row execute function app_private.preserve_legacy_status_on_cancellation();

create trigger preserve_project_legacy_status_on_cancellation
before update of execution_state_override, status_override on public.projects
for each row execute function app_private.preserve_legacy_status_on_cancellation();

revoke all on function app_private.preserve_legacy_status_on_cancellation()
from public, anon, authenticated;
grant execute on function app_private.preserve_legacy_status_on_cancellation()
to postgres, service_role;

-- Even if a caller supplies kind=blocker, an employee cannot update a stored
-- parking row through the generic blocker RPC.
create or replace function app_private.protect_employee_parking_updates()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.kind = 'parking' and exists (
    select 1 from public.organization_members m
    where m.organization_id = old.organization_id
      and m.user_id = new.updated_by
      and m.role = 'employee'
  ) then
    raise exception 'work_blocker_not_authorized';
  end if;
  return new;
end;
$$;

create trigger protect_employee_parking_updates
before update on public.work_blockers
for each row execute function app_private.protect_employee_parking_updates();

revoke all on function app_private.protect_employee_parking_updates()
from public, anon, authenticated;
grant execute on function app_private.protect_employee_parking_updates()
to postgres, service_role;

-- Resolve only the child parking rows created by this project parking action.
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
  v_child_blocker public.work_blockers%rowtype;
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

    for v_child_blocker in
      select * from public.work_blockers b
      where b.parent_project_parking_blocker_id = v_blocker.id
        and b.state = 'open'
      for update
    loop
      update public.work_blockers set
        state = 'resolved', version = v_child_blocker.version + 1,
        updated_by = p_actor_id, updated_at = now(), resolved_by = p_actor_id,
        resolved_at = now(), resolution_note = v_reason
      where id = v_child_blocker.id;
      insert into public.work_blocker_events (
        organization_id, blocker_id, event_type, before_state, after_state,
        created_by
      ) select p_organization_id, v_child_blocker.id, 'unparked',
        to_jsonb(v_child_blocker), to_jsonb(b), p_actor_id
      from public.work_blockers b where b.id = v_child_blocker.id;
      select * into v_job from public.jobs j
      where j.id = v_child_blocker.job_id
        and j.organization_id = p_organization_id
      for update;
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
      where id = v_child_blocker.job_id;
    end loop;

    update public.projects set
      status_override = case v_project.execution_state_override
        when 'not_started' then 'nicht_begonnen'::public.project_status
        when 'in_progress' then 'in_bearbeitung'::public.project_status
        when 'interrupted' then 'in_bearbeitung'::public.project_status
        when 'execution_complete' then 'abgeschlossen'::public.project_status
        when 'handed_over' then 'abgeschlossen'::public.project_status
        when 'cancelled' then v_project.status_override
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

-- Require both the exact organization marker and nested trigger execution.
create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then
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
