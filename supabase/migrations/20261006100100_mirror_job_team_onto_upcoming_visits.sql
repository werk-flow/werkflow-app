-- A change of the job's team reaches the job's upcoming visits, and only a
-- change that came from the job.
--
-- The trigger mirrors job_assignments onto the visits. Before this migration
-- it had three gaps:
-- - It ran for the team rows the planning functions add, so planning one
--   visit for a person also put that person on the job's legacy visit, a
--   visit the planner had not touched. It now stays quiet while
--   app.planning_projection_write is set, like the schedule trigger; only
--   app_private.project_plan_onto_job sets it (20261006100000).
-- - Taking a person off the team took them off the legacy visit only. A
--   visit planned in the calendar kept them, so the calendar showed work for
--   someone who had lost access to the job. The removal now reaches every
--   visit of the job that has not started, whatever its status.
-- - It rewrote visits that had already started. A started visit is history
--   (started_planning_occurrence_immutable) and now keeps its people.
--
-- An addition still reaches only the legacy visit, the one visit that the
-- job's own schedule columns describe. The signature and the trigger
-- definitions stay as they were. supabase/tests/job_plan_bridge.sql holds the
-- rules.
create or replace function app_private.sync_legacy_job_assignment()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  target_job_id uuid;
  target_user_id uuid;
  target_organization_id uuid;
  target_employee_record_id uuid;
begin
  if current_setting('app.planning_projection_write', true) = 'true' then
    return coalesce(new, old);
  end if;

  target_job_id := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  target_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

  select job.organization_id into target_organization_id
  from public.jobs job
  where job.id = target_job_id;

  select employee.id into target_employee_record_id
  from public.employee_records employee
  where employee.organization_id = target_organization_id
    and employee.user_id = target_user_id;

  if target_employee_record_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.planning_occurrence_assignments assignment
    using public.planning_occurrences occurrence
    where occurrence.id = assignment.occurrence_id
      and occurrence.organization_id = target_organization_id
      and occurrence.job_id = target_job_id
      and assignment.employee_record_id = target_employee_record_id
      and coalesce(
        occurrence.start_at > now(),
        occurrence.start_date > (now() at time zone 'Europe/Berlin')::date,
        false
      );
  else
    insert into public.planning_occurrence_assignments (
      organization_id,
      occurrence_id,
      employee_record_id,
      assigned_by,
      assigned_at
    )
    select
      target_organization_id,
      occurrence.id,
      target_employee_record_id,
      new.assigned_by,
      new.assigned_at
    from public.planning_occurrences occurrence
    where occurrence.legacy_source_job_id = target_job_id
      and coalesce(
        occurrence.start_at > now(),
        occurrence.start_date > (now() at time zone 'Europe/Berlin')::date,
        false
      )
    on conflict (occurrence_id, employee_record_id) do nothing;
  end if;

  return coalesce(new, old);
end;
$$;
