-- P1-12 / Wave-1 audit A7 (owner-approved Q2 fix): a job's Ort/Einsatzort
-- change is part of the dispatched material instruction (the revision
-- fingerprint already includes coalesce(occurrence.location, job.location)
-- and job.site_id), but no trigger on jobs fired the dispatch sync — a
-- location change invalidated confirmations only at the NEXT occurrence or
-- assignment touch, leaving workers with a confirmed card showing a stale
-- address. This additive trigger closes that gap by reusing the existing
-- idempotent sync (fingerprint-guarded, so double-fires are no-ops).

create or replace function app_private.sync_dispatch_on_job_location_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_occurrence record;
begin
  if new.location is not distinct from old.location
    and new.site_id is not distinct from old.site_id then
    return null;
  end if;
  for v_occurrence in
    select o.id
    from public.planning_occurrences o
    where o.job_id = new.id
      and exists (
        select 1
        from public.planning_dispatches d
        where d.occurrence_id = o.id
          and d.status = 'active'
      )
  loop
    perform app_private.sync_planning_dispatch_for_occurrence(v_occurrence.id);
  end loop;
  return null;
end;
$$;

create trigger sync_dispatch_on_job_location_change
after update of location, site_id on public.jobs
for each row
execute function app_private.sync_dispatch_on_job_location_change();