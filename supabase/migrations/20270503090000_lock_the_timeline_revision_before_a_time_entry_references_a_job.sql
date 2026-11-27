-- A time entry written onto a job locks its organization's timeline revision
-- row before it references the job row (werk-flow/werkflow-planning#361).
--
-- A time_entries insert, or an update that changes job_id, takes a key-share
-- lock on the job row through the foreign key check, then the revision row
-- through app_private.advance_time_timeline_revision, both AFTER row triggers
-- that fire in name order. A clock-in or break end on a job then locks the job
-- FOR UPDATE (app_private.transition_work_on_time_start), as does
-- public.transition_work_execution when the clock starts work on a job. A
-- writer that held the revision row from an earlier time write and then asked
-- for the job FOR UPDATE waited for the key share of a second writer that
-- waited for the revision row: `deadlock detected`. Two manual entries on one
-- job did it, and so did a clock switch onto a job that had not started
-- against a manual entry on that job.
--
-- This BEFORE trigger takes the revision row first, the order
-- app_private.validate_time_segment_input established (#348): the second
-- writer waits for the revision row before it holds anything on the job. It
-- runs after the guard triggers (names sort before it), so the period and
-- membership share locks keep their place ahead of the revision row. An entry
-- without a job, or an update that keeps or clears the job (a job deletion
-- sets it null), takes no lock on a job row and is left as it was.

create or replace function app_private.lock_time_timeline_revision_before_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is null
    or (tg_op = 'UPDATE' and new.job_id is not distinct from old.job_id)
  then return new; end if;
  insert into public.time_timeline_revisions (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;
  perform 1 from public.time_timeline_revisions revision
  where revision.organization_id = new.organization_id
  for update;
  return new;
end;
$$;

-- A trigger function: no role calls it directly.
revoke all on function app_private.lock_time_timeline_revision_before_job()
  from public, anon, authenticated, service_role;

create trigger lock_time_timeline_revision_before_job
  before insert or update of job_id on public.time_entries
  for each row execute function app_private.lock_time_timeline_revision_before_job();
