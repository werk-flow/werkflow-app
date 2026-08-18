create or replace function app_private.sync_job_status_from_planning_occurrences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid := coalesce(new.job_id, old.job_id);
begin
  if v_job_id is null then
    return coalesce(new, old);
  end if;

  perform set_config('app.planning_projection_write', 'true', true);

  if exists (
    select 1
    from public.planning_occurrences occurrence
    where occurrence.organization_id = coalesce(new.organization_id, old.organization_id)
      and occurrence.job_id = v_job_id
      and occurrence.status = 'scheduled'
  ) then
    update public.jobs
    set status = case
          when status = 'geparkt' then 'nicht_bearbeitet'::public.job_status
          else status
        end,
        updated_at = now()
    where id = v_job_id
      and organization_id = coalesce(new.organization_id, old.organization_id);
  else
    update public.jobs
    set planned_date = null,
        planned_time = null,
        status = case
          when status = 'fertig' then status
          else 'geparkt'::public.job_status
        end,
        updated_at = now()
    where id = v_job_id
      and organization_id = coalesce(new.organization_id, old.organization_id);
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function app_private.sync_job_status_from_planning_occurrences()
from public, anon, authenticated;
grant execute on function app_private.sync_job_status_from_planning_occurrences()
to postgres, service_role;

drop trigger if exists sync_job_status_from_planning_occurrences
on public.planning_occurrences;

create trigger sync_job_status_from_planning_occurrences
after insert or delete or update of status, job_id
on public.planning_occurrences
for each row
execute function app_private.sync_job_status_from_planning_occurrences();