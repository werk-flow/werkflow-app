-- P1-14 lifecycle history blocks direct work deletion, but a deliberate
-- organization deletion must retain the established full-cascade behavior.
-- Referential cascades enter this trigger below their parent delete; direct
-- job/project deletes remain at depth one and stay protected.

create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 then
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
