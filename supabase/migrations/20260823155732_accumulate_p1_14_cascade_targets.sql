-- A single delete statement can remove several disposable organizations.
-- Retain every target so each corresponding lifecycle-history cascade is allowed.

create or replace function app_private.mark_organization_cascade_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_targets text := current_setting('app.deleting_organization_ids', true);
begin
  perform set_config(
    'app.deleting_organization_ids',
    concat_ws(',', nullif(v_targets, ''), old.id::text),
    true
  );
  return old;
end;
$$;

create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.organization_id::text = any (
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

revoke all on function app_private.mark_organization_cascade_delete()
from public, anon, authenticated;
grant execute on function app_private.mark_organization_cascade_delete()
to postgres, service_role;

revoke all on function app_private.prevent_historic_work_delete()
from public, anon, authenticated;
grant execute on function app_private.prevent_historic_work_delete()
to postgres, service_role;
