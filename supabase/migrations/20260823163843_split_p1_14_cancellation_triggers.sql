-- PL/pgSQL binds record fields eagerly, so jobs and projects require functions
-- with their own concrete row shapes.

drop trigger preserve_job_legacy_status_on_cancellation on public.jobs;
drop trigger preserve_project_legacy_status_on_cancellation on public.projects;

create or replace function app_private.preserve_job_legacy_status_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.execution_state = 'cancelled'
    and old.execution_state is distinct from 'cancelled'
  then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create or replace function app_private.preserve_project_legacy_status_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.execution_state_override = 'cancelled'
    and old.execution_state_override is distinct from 'cancelled'
  then
    new.status_override := old.status_override;
  end if;
  return new;
end;
$$;

create trigger preserve_job_legacy_status_on_cancellation
before update of execution_state, status on public.jobs
for each row execute function app_private.preserve_job_legacy_status_on_cancellation();

create trigger preserve_project_legacy_status_on_cancellation
before update of execution_state_override, status_override on public.projects
for each row execute function app_private.preserve_project_legacy_status_on_cancellation();

revoke all on function app_private.preserve_job_legacy_status_on_cancellation()
from public, anon, authenticated;
grant execute on function app_private.preserve_job_legacy_status_on_cancellation()
to postgres, service_role;

revoke all on function app_private.preserve_project_legacy_status_on_cancellation()
from public, anon, authenticated;
grant execute on function app_private.preserve_project_legacy_status_on_cancellation()
to postgres, service_role;

drop function app_private.preserve_legacy_status_on_cancellation();
