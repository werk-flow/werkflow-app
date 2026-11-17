-- The office's attention read also returns the open jobs that need planning,
-- so the two new Aufgaben kinds add no backend request (lab.office.cold-start):
--   unplanned_jobs: open jobs with no scheduled visit and nobody assigned,
--     oldest first;
--   overdue_jobs: open jobs whose every scheduled visit has ended, with the
--     end of their last timed and last all-day visit. lib/attention/job-tasks.ts
--     decides from these which jobs are past their last visit on the Berlin day.
-- Open means the job's status mirrors an open execution state (not started,
-- in progress, interrupted); parked and finished jobs carry another status
-- (jobs_open_organization_created_idx). A cancelled job keeps the status it had
-- (preserve_job_legacy_status_on_cancellation), so its state excludes it. Each open job's assignments, visits and project are
-- probed by its key alone (a visit through the partial job index of its time
-- kind), with the organization checked in the aggregate or the selected value:
-- an organization filter in the probe's WHERE clause lets the planner walk the
-- organization's rows for every job (supabase/tests/hot_read_volume.sql). The requests and access proposals stay as before, and
-- the result only gains keys, so the previous build reads it unchanged. Each
-- array holds at most p_limit + 1 rows, so the caller sees an overflow
-- instead of a cut.
-- The open jobs of an organization in the read's order. Without it the planner
-- picks between the organization's job indexes by statistics and may walk
-- every finished job (supabase/tests/hot_read_volume.sql, aufgaben-office-sets).
create index jobs_open_organization_created_idx
  on public.jobs (organization_id, created_at, id)
  where status in ('nicht_bearbeitet', 'in_bearbeitung');

create or replace function public.read_manager_attention_sets(p_organization_id uuid, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(to_jsonb(open_request) order by open_request.received_at, open_request.id)
      from (
        select
          request.id, request.request_number, request.summary, request.status, request.urgency,
          request.assigned_to, request.received_at, request.callback_due_at,
          coalesce(request.callback_due_at < now(), false) as callback_overdue,
          exists (
            select 1 from public.organization_members member
            where member.organization_id = p_organization_id
              and member.user_id = request.assigned_to
              and member.role in ('admin', 'buero')
              -- A suspended or ended manager keeps the membership row but cannot act.
              and app_private.p1_24_has_effective_access(member.organization_id, member.user_id)
          ) as owner_is_manager
        from public.client_requests request
        where request.organization_id = p_organization_id
          and request.status in ('offen', 'in_klaerung')
        order by request.received_at, request.id
        limit p_limit + 1
      ) open_request
    ), '[]'::jsonb),
    'access_proposals', coalesce((
      select jsonb_agg(to_jsonb(open_proposal) order by open_proposal.proposed_at, open_proposal.id)
      from (
        select
          proposal.id, proposal.job_id, proposal.site_id, proposal.proposed_by, proposal.proposed_at
        from public.site_access_proposals proposal
        where proposal.organization_id = p_organization_id
          and proposal.status = 'open'
        order by proposal.proposed_at, proposal.id
        limit p_limit + 1
      ) open_proposal
    ), '[]'::jsonb),
    'unplanned_jobs', coalesce((
      select jsonb_agg(to_jsonb(unplanned_job) order by unplanned_job.created_at, unplanned_job.id)
      from (
        select
          job.id, job.job_number, job.title, job.project_id, job.created_at,
          (
            select case when project.organization_id = p_organization_id then project.project_number end
            from public.projects project
            where project.id = job.project_id
          ) as project_number
        from public.jobs job
        cross join lateral (
          select count(*) filter (where assignment.organization_id = p_organization_id) as assignments
          from public.job_assignments assignment
          where assignment.job_id = job.id
        ) team
        cross join lateral (
          select count(*) filter (where visit.organization_id = p_organization_id) as visits
          from public.planning_occurrences visit
          where visit.job_id = job.id and visit.start_at is not null and visit.status = 'scheduled'
        ) timed
        cross join lateral (
          select count(*) filter (where visit.organization_id = p_organization_id) as visits
          from public.planning_occurrences visit
          where visit.job_id = job.id and visit.start_date is not null and visit.status = 'scheduled'
        ) all_day
        where job.organization_id = p_organization_id
          and job.status in ('nicht_bearbeitet', 'in_bearbeitung')
          and job.execution_state is distinct from 'cancelled'
          and team.assignments = 0
          and timed.visits = 0
          and all_day.visits = 0
        order by job.created_at, job.id
        limit p_limit + 1
      ) unplanned_job
    ), '[]'::jsonb),
    'overdue_jobs', coalesce((
      select jsonb_agg(to_jsonb(overdue_job) order by overdue_job.created_at, overdue_job.id)
      from (
        select
          job.id, job.job_number, job.title, job.project_id, job.created_at,
          timed.last_timed_end, all_day.last_all_day_end,
          (
            select case when project.organization_id = p_organization_id then project.project_number end
            from public.projects project
            where project.id = job.project_id
          ) as project_number
        from public.jobs job
        cross join lateral (
          select max(visit.end_at) filter (where visit.organization_id = p_organization_id) as last_timed_end
          from public.planning_occurrences visit
          where visit.job_id = job.id and visit.start_at is not null and visit.status = 'scheduled'
        ) timed
        cross join lateral (
          select max(visit.end_date_exclusive) filter (where visit.organization_id = p_organization_id)
            as last_all_day_end
          from public.planning_occurrences visit
          where visit.job_id = job.id and visit.start_date is not null and visit.status = 'scheduled'
        ) all_day
        where job.organization_id = p_organization_id
          and job.status in ('nicht_bearbeitet', 'in_bearbeitung')
          and job.execution_state is distinct from 'cancelled'
          and (timed.last_timed_end is not null or all_day.last_all_day_end is not null)
          -- No scheduled visit is still running or ahead.
          and coalesce(timed.last_timed_end <= now(), true)
          and coalesce(all_day.last_all_day_end <= (now() at time zone 'Europe/Berlin')::date, true)
        order by job.created_at, job.id
        limit p_limit + 1
      ) overdue_job
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.read_manager_attention_sets(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_manager_attention_sets(uuid, integer) to service_role;
