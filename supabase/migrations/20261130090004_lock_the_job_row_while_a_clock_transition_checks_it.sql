-- A clock transition locks the job row while it checks the job is not parked
-- or finished (werk-flow/werkflow-planning#348).
--
-- app_private.validate_time_segment_input read the job's status without a
-- lock, so a park committing between that read and the segment insert let the
-- clock start on a parked job. It now locks the organization's timeline
-- revision row and then the job row; the rest of the function is unchanged
-- from 20261130090000. It keeps its signature, owner and grants (create or
-- replace). Its only caller is app_private.transition_time_activity, which
-- runs as the owner inside public.transition_time_activity.

create or replace function app_private.validate_time_segment_input(
  p_organization_id uuid,
  p_actor_id uuid,
  p_role public.org_role,
  p_kind public.time_segment_kind,
  p_allocation_kind public.time_allocation_kind,
  p_job_id uuid,
  p_internal_type public.planning_internal_type,
  p_travel_route public.time_travel_route,
  p_travel_role public.time_travel_role,
  p_standby_context public.time_standby_context
) returns void language plpgsql set search_path = '' as $$
declare
  v_break_mode public.time_tracking_break_mode;
  v_job_status public.job_status;
begin
  if p_kind in ('work', 'travel', 'callout') then
    if p_allocation_kind not in ('job', 'unallocated')
      or (p_allocation_kind = 'job') <> (p_job_id is not null)
      or p_internal_type is not null
    then raise exception 'time_transition_allocation_invalid'; end if;
  elsif p_kind = 'internal_activity' then
    if p_allocation_kind <> 'internal_activity' or p_job_id is not null
      or p_internal_type is null
    then raise exception 'time_transition_allocation_invalid'; end if;
  elsif p_kind in ('break', 'standby') then
    if p_allocation_kind <> 'none' or p_job_id is not null or p_internal_type is not null
    then raise exception 'time_transition_allocation_invalid'; end if;
  end if;

  if (p_kind = 'travel') <> (p_travel_route is not null and p_travel_role is not null)
    or (p_kind <> 'travel' and (p_travel_route is not null or p_travel_role is not null))
  then raise exception 'time_transition_travel_invalid'; end if;

  if (p_kind = 'standby') <> (p_standby_context is not null)
    or (p_kind <> 'standby' and p_standby_context is not null)
  then raise exception 'time_transition_standby_invalid'; end if;

  if p_kind = 'break' then
    select settings.break_mode into v_break_mode
    from public.organization_settings settings
    where settings.organization_id = p_organization_id;
    if coalesce(v_break_mode, 'manual'::public.time_tracking_break_mode) <> 'manual'
    then raise exception 'time_transition_break_mode_automatic'; end if;
  end if;

  if p_job_id is not null then
    -- The job row stays locked until the transition commits, so a concurrent
    -- park or finish either commits first and is refused here, or waits until
    -- the segment is written.
    --
    -- Lock order: every time write locks the organization's timeline revision
    -- row (advance_time_timeline_revision) and only then, when it starts work
    -- on a job, the job row. This transition writes a segment after this
    -- check, so it takes the revision row first; a job lock taken before it
    -- would deadlock with a time write that holds the revision and waits for
    -- the job. FOR NO KEY UPDATE conflicts with the park's and the finish's
    -- lock, but not with the key-share lock of a row that references the job:
    -- another time entry on this job that waits for the revision row does not
    -- block this transition.
    insert into public.time_timeline_revisions (organization_id)
    values (p_organization_id)
    on conflict (organization_id) do nothing;
    perform 1 from public.time_timeline_revisions revision
    where revision.organization_id = p_organization_id
    for update;

    select job.status into v_job_status
    from public.jobs job
    where job.id = p_job_id
      and job.organization_id = p_organization_id
    for no key update;
    if not found or v_job_status in ('fertig', 'geparkt')
    then raise exception 'time_transition_job_unavailable'; end if;

    if p_role = 'employee' and not exists (
      select 1 from public.job_assignments assignment
      where assignment.organization_id = p_organization_id
        and assignment.job_id = p_job_id
        and assignment.user_id = p_actor_id
    ) then raise exception 'time_transition_job_not_assigned'; end if;
  end if;
end;
$$;
