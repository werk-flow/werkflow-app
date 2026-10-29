-- A manual time entry of an employee names only a job the employee is
-- assigned to (werk-flow/werkflow-planning#41).
--
-- addManualEntry (lib/time-tracking/entry-write-actions.ts) checks the
-- assignment before it inserts, but an assignment removed between that read
-- and the insert was not caught. The live clock checks the assignment inside
-- its own transaction (app_private.validate_time_segment_input). This
-- trigger does the same for a manual entry at insert time and refuses with
-- 'manual_entry_job_not_assigned'.
--
-- Only an Admin or Büro member's entry skips the check, as on the clock; a
-- user without a membership is refused. Automatic entries, such as the break
-- end of a settings change, keep their job without a check.

create or replace function app_private.guard_manual_time_entry_job_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_manual is not true or new.job_id is null then return new; end if;
  if exists (
    select 1 from public.organization_members member
    where member.organization_id = new.organization_id
      and member.user_id = new.user_id
      and member.role in ('admin', 'buero')
  ) then return new; end if;
  if not exists (
    select 1 from public.job_assignments assignment
    where assignment.organization_id = new.organization_id
      and assignment.job_id = new.job_id
      and assignment.user_id = new.user_id
  ) then raise exception 'manual_entry_job_not_assigned'; end if;
  return new;
end;
$$;

-- A trigger function: no role calls it directly.
revoke all on function app_private.guard_manual_time_entry_job_assignment()
  from public, anon, authenticated, service_role;

create trigger guard_manual_time_entry_job_assignment
  before insert on public.time_entries
  for each row execute function app_private.guard_manual_time_entry_job_assignment();
