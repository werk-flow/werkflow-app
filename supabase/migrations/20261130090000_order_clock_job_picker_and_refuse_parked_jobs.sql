-- The clock never runs on a parked job, and its job picker names the jobs a
-- worker most likely means first.
--
-- 1. app_private.validate_time_segment_input refuses a parked job like a
--    finished one, so a clock-in, switch or resume on it fails atomically
--    with 'time_transition_job_unavailable'. Only clock transitions call it;
--    corrections and manual entries keep their own checks.
-- 2. public.search_clock_job_options leaves parked jobs out and ranks every
--    option into one group before the page is cut: the caller's own job in
--    progress, the caller's visits today, the caller's next visit by date,
--    the caller's other jobs, then (office roles only) everyone else's jobs.
--    Each option carries its group and next visit date for the picker, and
--    keeps 'plannedToday', so the app release before this one still reads it.
--
-- Both keep their signatures, owners and grants (create or replace).

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
    if not exists (
      select 1 from public.jobs job
      where job.id = p_job_id
        and job.organization_id = p_organization_id
        and job.status not in ('fertig', 'geparkt')
    ) then raise exception 'time_transition_job_unavailable'; end if;

    if p_role = 'employee' and not exists (
      select 1 from public.job_assignments assignment
      where assignment.organization_id = p_organization_id
        and assignment.job_id = p_job_id
        and assignment.user_id = p_actor_id
    ) then raise exception 'time_transition_job_not_assigned'; end if;
  end if;
end;
$$;

create or replace function public.search_clock_job_options(
  p_organization_id uuid,
  p_user_id uuid,
  p_is_manager boolean,
  p_today date,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_search text default '',
  p_limit integer default 50,
  p_selected_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with own_visits as (
    -- The caller's scheduled visits from today on: whether one falls on
    -- today's Berlin date, and the Berlin date of the first one after it.
    select occurrence.job_id,
      bool_or(
        (occurrence.time_kind = 'timed' and occurrence.start_at < p_day_end and occurrence.end_at > p_day_start)
        or (occurrence.time_kind = 'all_day' and occurrence.start_date <= p_today and occurrence.end_date_exclusive > p_today)
      ) as today,
      min(
        case when occurrence.time_kind = 'timed'
          then (occurrence.start_at at time zone 'Europe/Berlin')::date
          else occurrence.start_date
        end
      ) filter (where
        (occurrence.time_kind = 'timed' and occurrence.start_at >= p_day_end)
        or (occurrence.time_kind = 'all_day' and occurrence.start_date > p_today)
      ) as next_date
    from public.planning_occurrences occurrence
    join public.planning_occurrence_assignments assignment
      on assignment.occurrence_id = occurrence.id and assignment.organization_id = p_organization_id
    join public.employee_records record
      on record.id = assignment.employee_record_id and record.organization_id = p_organization_id
    where occurrence.organization_id = p_organization_id
      and record.user_id = p_user_id
      and occurrence.entry_kind = 'job_visit'
      and occurrence.status = 'scheduled'
      and occurrence.job_id is not null
      and (
        (occurrence.time_kind = 'timed' and occurrence.end_at > p_day_start)
        or (occurrence.time_kind = 'all_day' and occurrence.end_date_exclusive > p_today)
      )
    group by occurrence.job_id
  ), visible as (
    select job.id, job.title, job.description, job.job_number, job.status,
      project.name as project_name, client.name as client_name,
      coalesce(visit.today, false) as planned_today,
      visit.next_date,
      exists (
        select 1 from public.job_assignments assignment
        where assignment.organization_id = p_organization_id
          and assignment.job_id = job.id
          and assignment.user_id = p_user_id
      ) as own,
      coalesce(job.execution_state::text, case when job.status = 'in_bearbeitung' then 'in_progress' end)
        = 'in_progress' as in_progress
    from public.jobs job
    left join public.projects project
      on project.id = job.project_id and project.organization_id = p_organization_id
    left join public.clients client
      on client.id = job.client_id and client.organization_id = p_organization_id
    left join own_visits visit on visit.job_id = job.id
    where job.organization_id = p_organization_id
      and (
        coalesce(p_is_manager, false)
        or exists (
          select 1 from public.job_assignments assignment
          where assignment.organization_id = p_organization_id
            and assignment.job_id = job.id
            and assignment.user_id = p_user_id
        )
      )
  ), grouped as (
    select visible.*,
      case
        when own and in_progress then 'in_progress'
        when planned_today then 'today'
        when next_date is not null then 'upcoming'
        when own then 'own'
        else 'other'
      end as picker_group
    from visible
  ), ranked as (
    select grouped.*,
      case picker_group
        when 'in_progress' then 0 when 'today' then 1 when 'upcoming' then 2 when 'own' then 3 else 4
      end as picker_rank
    from grouped
  ), matching as materialized (
    select * from ranked
    where status not in ('fertig', 'geparkt')
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', title, description, job_number, project_name, client_name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by picker_rank, case when picker_group = 'upcoming' then next_date end nulls last, title, id
    limit least(greatest(coalesce(p_limit, 50), 1), 1000) + 1
  ), choices as (
    select * from page
    order by picker_rank, case when picker_group = 'upcoming' then next_date end nulls last, title, id
    limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object(
        'id', id, 'title', title, 'description', description, 'jobNumber', job_number, 'status', status,
        'projectName', project_name, 'clientName', client_name, 'plannedToday', planned_today,
        'group', picker_group, 'nextVisitDate', next_date)
      order by picker_rank, case when picker_group = 'upcoming' then next_date end nulls last, title, id)
      from choices), '[]'),
    'hasMore', (select count(*) > least(greatest(coalesce(p_limit, 50), 1), 1000) from page),
    'selected', (select jsonb_build_object(
        'id', id, 'title', title, 'description', description, 'jobNumber', job_number, 'status', status,
        'projectName', project_name, 'clientName', client_name, 'plannedToday', planned_today,
        'group', picker_group, 'nextVisitDate', next_date)
      from ranked where id = p_selected_id)
  );
$$;
