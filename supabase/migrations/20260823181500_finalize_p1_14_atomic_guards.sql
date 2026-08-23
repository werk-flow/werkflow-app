-- Consume privileged write flags on the guarded statement itself. A caller
-- cannot reuse a transaction-local flag after the owning RPC update.
create or replace function app_private.guard_job_execution_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (new.execution_state, new.execution_version)
      is distinct from (old.execution_state, old.execution_version)
  then
    if coalesce(current_setting('app.work_execution_write', true), '') <> 'true'
    then raise exception 'work_execution_direct_write_forbidden'; end if;
    perform set_config('app.work_execution_write', 'false', true);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_execution_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (
      new.execution_state_override,
      new.execution_version,
      new.execution_override_reason
    ) is distinct from (
      old.execution_state_override,
      old.execution_version,
      old.execution_override_reason
    )
  then
    if coalesce(current_setting('app.work_execution_write', true), '') <> 'true'
    then raise exception 'work_execution_direct_write_forbidden'; end if;
    perform set_config('app.work_execution_write', 'false', true);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_instruction_item_completion_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (new.is_completed, new.completion_version) is distinct from
    (old.is_completed, old.completion_version)
  then
    if coalesce(
      current_setting('app.work_instruction_completion_write', true), ''
    ) <> 'true'
    then raise exception 'instruction_completion_requires_transition'; end if;
    perform set_config('app.work_instruction_completion_write', 'false', true);
  end if;
  return new;
end;
$$;

-- The project blocker id is known before child blockers are inserted. Carry it
-- through the same transaction instead of reconstructing provenance afterward.
create or replace function app_private.set_project_parking_parent()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_parent_id uuid;
begin
  if coalesce(current_setting('app.project_parking_cascade', true), '') <> 'true'
  then return new; end if;

  if new.kind = 'parking' and new.project_id is not null then
    perform set_config(
      'app.project_parking_parent_blocker_id', new.id::text, true
    );
    return new;
  end if;

  if new.kind = 'parking' and new.job_id is not null then
    v_parent_id := nullif(
      current_setting('app.project_parking_parent_blocker_id', true), ''
    )::uuid;
    if v_parent_id is not null and exists (
      select 1
      from public.work_blockers parent
      join public.jobs child
        on child.id = new.job_id
       and child.project_id = parent.project_id
       and child.organization_id = parent.organization_id
      where parent.id = v_parent_id
        and parent.organization_id = new.organization_id
        and parent.kind = 'parking'
    ) then
      new.parent_project_parking_blocker_id := v_parent_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger set_project_parking_parent
before insert on public.work_blockers
for each row execute function app_private.set_project_parking_parent();

revoke all on function app_private.set_project_parking_parent()
from public, anon, authenticated;
grant execute on function app_private.set_project_parking_parent()
to postgres, service_role;

create or replace function public.park_work_target(
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
  perform set_config('app.project_parking_cascade', 'false', true);
  perform set_config('app.project_parking_parent_blocker_id', '', true);
  if p_target_type = 'project' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_target_id::text, 0)
    );
    perform set_config('app.project_parking_cascade', 'true', true);
  end if;

  v_blocker_id := app_private.park_work_target_base(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_execution_version, p_reason, p_details,
    p_responsible_employee_record_id, p_next_review_date
  );

  perform set_config('app.project_parking_cascade', 'false', true);
  perform set_config('app.project_parking_parent_blocker_id', '', true);
  return v_blocker_id;
end;
$$;

revoke all on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) to service_role;

alter function public.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
  set schema app_private;
alter function app_private.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
  rename to unpark_work_target_base;

revoke all on function app_private.unpark_work_target_base(
  uuid, uuid, text, uuid, bigint, text
) from public, anon, authenticated, service_role;

create function public.unpark_work_target(
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
begin
  if p_target_type = 'project' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_target_id::text, 0)
    );
  end if;
  return app_private.unpark_work_target_base(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_blocker_version, p_reason
  );
end;
$$;

revoke all on function public.unpark_work_target(
  uuid, uuid, text, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.unpark_work_target(
  uuid, uuid, text, uuid, bigint, text
) to service_role;

create index time_entries_open_clock_lookup_idx
on public.time_entries(organization_id, user_id, timestamp desc)
where status not in ('rejected', 'pending_delete');
