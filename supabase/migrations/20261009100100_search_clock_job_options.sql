-- The clock-in and job-switch picker read every open job of the organization
-- (managers) and ranked and searched them in the browser. This reader
-- searches in the database and ranks the caller's own visits of today first:
-- a scheduled job visit assigned to the caller's employee record that is
-- timed and overlaps [p_day_start, p_day_end), or all-day and covers p_today.
-- Then title and id. Managers see every open job, other roles only the jobs
-- they are assigned to. The live picker re-reads what it shows, so the
-- reader returns the first p_limit rows (1 to 1,000) and whether more
-- follow. p_selected_id, the running job of a switch, comes back as
-- `selected` while the caller may see it, also when it is finished.
-- Service-role only: the caller resolves the organization, the user and the
-- role first.
create function public.search_clock_job_options(
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
  with planned as (
    select distinct occurrence.job_id
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
        (occurrence.time_kind = 'timed' and occurrence.start_at < p_day_end and occurrence.end_at > p_day_start)
        or (occurrence.time_kind = 'all_day' and occurrence.start_date <= p_today and occurrence.end_date_exclusive > p_today)
      )
  ), visible as (
    select job.id, job.title, job.description, job.job_number, job.status,
      project.name as project_name, client.name as client_name,
      exists (select 1 from planned where planned.job_id = job.id) as planned_today
    from public.jobs job
    left join public.projects project
      on project.id = job.project_id and project.organization_id = p_organization_id
    left join public.clients client
      on client.id = job.client_id and client.organization_id = p_organization_id
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
  ), matching as materialized (
    select * from visible
    where status <> 'fertig'
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', title, description, job_number, project_name, client_name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by planned_today desc, title, id
    limit least(greatest(coalesce(p_limit, 50), 1), 1000) + 1
  ), choices as (
    select * from page
    order by planned_today desc, title, id
    limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object(
        'id', id, 'title', title, 'description', description, 'jobNumber', job_number, 'status', status,
        'projectName', project_name, 'clientName', client_name, 'plannedToday', planned_today)
      order by planned_today desc, title, id) from choices), '[]'),
    'hasMore', (select count(*) > least(greatest(coalesce(p_limit, 50), 1), 1000) from page),
    'selected', (select jsonb_build_object(
        'id', id, 'title', title, 'description', description, 'jobNumber', job_number, 'status', status,
        'projectName', project_name, 'clientName', client_name, 'plannedToday', planned_today)
      from visible where id = p_selected_id)
  );
$$;
revoke all on function public.search_clock_job_options(uuid, uuid, boolean, date, timestamptz, timestamptz, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.search_clock_job_options(uuid, uuid, boolean, date, timestamptz, timestamptz, text, integer, uuid) to service_role;
