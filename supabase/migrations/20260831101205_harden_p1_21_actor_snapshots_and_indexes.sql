-- Actor UUIDs are historical attribution snapshots. Keeping ON DELETE SET NULL
-- foreign keys would make auth-user deletion issue an unprivileged update that
-- the canonical write guard correctly rejects. Preserve the UUID facts instead.
alter table public.time_sessions
  drop constraint time_sessions_created_by_fkey,
  drop constraint time_sessions_ended_by_fkey;
alter table public.time_segments
  drop constraint time_segments_started_by_fkey,
  drop constraint time_segments_ended_by_fkey;

create index time_sessions_employee_org_fk_idx
  on public.time_sessions(employee_record_id, organization_id);
create index time_segments_employee_org_fk_idx
  on public.time_segments(employee_record_id, organization_id);
create index time_segments_job_org_fk_idx
  on public.time_segments(job_id, organization_id)
  where job_id is not null;
create index time_operations_employee_org_fk_idx
  on public.time_operations(employee_record_id, organization_id);
