-- The admin's weekly company numbers (werk-flow/werkflow-planning#278), read
-- from rows WerkFlow already stores: no table, column or event is added.
-- Each number has one function here, so a later reader (the owner start)
-- calls the same rule instead of counting again. Every function counts the
-- whole organization and never groups by person.
--
-- A job finishes on site with a `transitioned` event to `execution_complete`;
-- a withdrawn handover returns to that state but finishes nothing.
--
-- A past week is counted from what the rows hold now. Where a row keeps no
-- history of a change (a moved due date, a reopened request, a moved review
-- date), the count uses the current value (docs/features/weekly-numbers.md,
-- "Current limits").

-- Workdays are Monday to Friday Berlin calendar days; no module knows the
-- organization's holidays yet. The days after p_from up to and including p_to.
create function public.count_berlin_workdays(p_from date, p_to date)
returns integer language sql immutable security invoker set search_path = '' as $$
  select case when p_to <= p_from then 0 else
    ((p_to - p_from) / 7) * 5 + (
      select count(*)::integer
      from generate_series(1, (p_to - p_from) % 7) as step(day_offset)
      where extract(isodow from p_from + ((p_to - p_from) / 7) * 7 + step.day_offset) < 6
    )
  end
$$;

-- The instant a Berlin day ends, or now while that day is still running.
create function public.berlin_day_end_or_now(p_day date)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select least(now(), ((p_day + 1)::timestamp at time zone 'Europe/Berlin'))
$$;

-- K2: the overdue open items at the end of Berlin day p_day, by kind.
-- * follow-ups: due before then and neither completed nor cancelled by then;
-- * request callbacks: a request still open then whose „Rückruf bis“ passed;
-- * maintenance: owed then and its window ended before p_day; a row closed
--   without a completion day counts until its last change;
-- * requests: still open then, more than 3 workdays after they were received;
-- * handovers: a job back at its finish on site, without a reviewed release
--   since, more than 2 workdays after its last finish (a withdrawn handover
--   returns the job to the finish state but is no new finish);
-- * blocker reviews: a blocker or parking open then whose review date lies
--   before p_day.
create function public.count_overdue_items_at(p_organization_id uuid, p_day date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with cutoff as (
    select public.berlin_day_end_or_now(p_day) as at
  ), open_requests as (
    select request.id, request.received_at, request.callback_due_at
    from public.client_requests request, cutoff
    where request.organization_id = p_organization_id
      and request.received_at < cutoff.at
      and (
        request.status in ('offen', 'in_klaerung')
        or coalesce(
          request.closed_at,
          request.converted_at,
          (select min(entry.created_at) from public.work_request_entries entry
            where entry.organization_id = p_organization_id and entry.request_id = request.id),
          request.updated_at
        ) >= cutoff.at
      )
  ), job_states as (
    select distinct on (event.job_id) event.job_id, event.to_state, event.created_at,
      coalesce((select max(finish.created_at) from public.work_execution_events finish
        where finish.organization_id = p_organization_id
          and finish.job_id = event.job_id
          and finish.event_type = 'transitioned'
          and finish.to_state = 'execution_complete'
          and finish.created_at <= event.created_at), event.created_at) as finished_at
    from public.work_execution_events event, cutoff
    where event.organization_id = p_organization_id
      and event.job_id is not null
      and event.to_state is not null
      and event.created_at < cutoff.at
    order by event.job_id, event.created_at desc, event.resulting_version desc
  )
  select jsonb_build_object(
    'followUps', (
      select count(*) from public.client_follow_ups follow_up, cutoff
      where follow_up.organization_id = p_organization_id
        and follow_up.created_at < cutoff.at
        and follow_up.due_at < cutoff.at
        and coalesce(follow_up.completed_at, follow_up.cancelled_at, 'infinity') >= cutoff.at
    ),
    'requestCallbacks', (
      select count(*) from open_requests, cutoff
      where open_requests.callback_due_at < cutoff.at
    ),
    'maintenance', (
      select count(*) from public.maintenance_due_work due, cutoff
      where due.organization_id = p_organization_id
        and due.created_at < cutoff.at
        and due.window_end_date < p_day
        and (
          due.status in ('open', 'visit_created')
          or (due.status = 'completed' and due.completed_on > p_day)
          or (due.status in ('skipped', 'cancelled', 'superseded') and due.updated_at >= cutoff.at)
        )
    ),
    'staleRequests', (
      select count(*) from open_requests
      where public.count_berlin_workdays((open_requests.received_at at time zone 'Europe/Berlin')::date, p_day) > 3
    ),
    'waitingHandovers', (
      select count(*) from job_states, cutoff
      where job_states.to_state = 'execution_complete'
        and public.count_berlin_workdays((job_states.finished_at at time zone 'Europe/Berlin')::date, p_day) > 2
        and not exists (
          select 1 from public.work_handover_releases release
          join public.work_handover_packages handover
            on handover.id = release.package_id and handover.organization_id = p_organization_id
          where release.organization_id = p_organization_id
            and handover.job_id = job_states.job_id
            and release.reviewed_at >= job_states.created_at
            and release.reviewed_at < cutoff.at
        )
    ),
    'blockerReviews', (
      select count(*) from public.work_blockers blocker, cutoff
      where blocker.organization_id = p_organization_id
        and blocker.created_at < cutoff.at
        and blocker.next_review_date < p_day
        and (blocker.state = 'open' or blocker.resolved_at >= cutoff.at)
    )
  )
$$;

-- T2: the jobs whose handover was first released after their last finish on
-- site within [p_from, p_to), with the median workdays from that finish to
-- the reviewed release and how many took at most 2 workdays.
create function public.measure_handover_turnaround(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with releases as (
    select handover.job_id, release.reviewed_at,
      (select max(event.created_at) from public.work_execution_events event
        where event.organization_id = p_organization_id
          and event.job_id = handover.job_id
          and event.event_type = 'transitioned'
          and event.to_state = 'execution_complete'
          and event.created_at <= release.reviewed_at) as finished_at
    from public.work_handover_releases release
    join public.work_handover_packages handover
      on handover.id = release.package_id and handover.organization_id = p_organization_id
    where release.organization_id = p_organization_id
      and handover.job_id is not null
      and release.reviewed_at >= p_from
      and release.reviewed_at < p_to
  ), first_releases as (
    select public.count_berlin_workdays(
      (releases.finished_at at time zone 'Europe/Berlin')::date,
      (releases.reviewed_at at time zone 'Europe/Berlin')::date
    ) as workdays
    from releases
    where releases.finished_at is not null
      and not exists (
        select 1 from public.work_handover_releases earlier
        join public.work_handover_packages handover
          on handover.id = earlier.package_id and handover.organization_id = p_organization_id
        where earlier.organization_id = p_organization_id
          and handover.job_id = releases.job_id
          and earlier.reviewed_at >= releases.finished_at
          and earlier.reviewed_at < releases.reviewed_at
      )
  )
  select jsonb_build_object(
    'released', count(*),
    'medianWorkdays', percentile_cont(0.5) within group (order by first_releases.workdays),
    'withinTwoWorkdays', count(*) filter (where first_releases.workdays <= 2)
  )
  from first_releases
$$;

-- A1: the jobs finished on site within [p_from, p_to), and how many of them
-- have a submitted or approved work report now.
create function public.measure_work_report_share(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with finished as (
    select distinct event.job_id
    from public.work_execution_events event
    where event.organization_id = p_organization_id
      and event.job_id is not null
      and event.event_type = 'transitioned'
      and event.to_state = 'execution_complete'
      and event.created_at >= p_from
      and event.created_at < p_to
  )
  select jsonb_build_object(
    'finished', count(*),
    'withReport', count(*) filter (where exists (
      select 1 from public.work_artifacts artifact
      where artifact.organization_id = p_organization_id
        and artifact.job_id = finished.job_id
        and artifact.kind = 'work_report'
        and artifact.status in ('submitted', 'approved')
    ))
  )
  from finished
$$;

-- A2: the time entries stamped within [p_from, p_to), a rejected one aside,
-- and how many of them the person who worked recorded.
create function public.measure_own_time_capture_share(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'entries', count(*),
    'byEmployee', count(*) filter (where entry.capture_source = 'employee')
  )
  from public.time_entries entry
  where entry.organization_id = p_organization_id
    and entry.status <> 'rejected'
    and entry.timestamp >= p_from
    and entry.timestamp < p_to
$$;

-- The last p_week_count weeks up to the week of p_today (Berlin), oldest
-- first. A week runs Monday to Sunday; the running week counts up to now.
create function public.read_weekly_outcome_numbers(p_organization_id uuid, p_today date, p_week_count integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select week_start, least(week_start + 6, p_today) as last_day,
      (week_start::timestamp at time zone 'Europe/Berlin') as starts_at,
      public.berlin_day_end_or_now(least(week_start + 6, p_today)) as ends_at
    from (
      select (date_trunc('week', p_today::timestamp)::date - 7 * step.week_offset) as week_start
      from generate_series(0, least(greatest(coalesce(p_week_count, 12), 1), 52) - 1) as step(week_offset)
    ) as week
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'weekStart', weeks.week_start,
    'lastDay', weeks.last_day,
    'overdue', public.count_overdue_items_at(p_organization_id, weeks.last_day),
    'handover', public.measure_handover_turnaround(p_organization_id, weeks.starts_at, weeks.ends_at),
    'workReports', public.measure_work_report_share(p_organization_id, weeks.starts_at, weeks.ends_at),
    'timeCapture', public.measure_own_time_capture_share(p_organization_id, weeks.starts_at, weeks.ends_at)
  ) order by weeks.week_start), '[]'::jsonb)
  from weeks
$$;

-- Only the server reads them, after it established an admin of the organization.
revoke all on function public.count_berlin_workdays(date, date) from public, anon, authenticated;
grant execute on function public.count_berlin_workdays(date, date) to service_role;
revoke all on function public.berlin_day_end_or_now(date) from public, anon, authenticated;
grant execute on function public.berlin_day_end_or_now(date) to service_role;
revoke all on function public.count_overdue_items_at(uuid, date) from public, anon, authenticated;
grant execute on function public.count_overdue_items_at(uuid, date) to service_role;
revoke all on function public.measure_handover_turnaround(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.measure_handover_turnaround(uuid, timestamptz, timestamptz) to service_role;
revoke all on function public.measure_work_report_share(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.measure_work_report_share(uuid, timestamptz, timestamptz) to service_role;
revoke all on function public.measure_own_time_capture_share(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.measure_own_time_capture_share(uuid, timestamptz, timestamptz) to service_role;
revoke all on function public.read_weekly_outcome_numbers(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.read_weekly_outcome_numbers(uuid, date, integer) to service_role;
