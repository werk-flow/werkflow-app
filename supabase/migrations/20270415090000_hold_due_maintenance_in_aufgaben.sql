-- The office's attention read also returns the open due maintenance that
-- belongs in Aufgaben (due_maintenance), so the kind „Fällige Wartungen“ adds
-- no backend request (lab.admin.tasks-open, lab.office.cold-start).
-- An item belongs there while it is open, so without a visit job, and its due
-- date lies at most 14 days after today in Berlin: überfällig or due within
-- the lead time. lib/maintenance/overdue.ts (isMaintenanceDueForAufgaben,
-- MAINTENANCE_DUE_LEAD_DAYS) holds the same window and decides on the Berlin
-- day the overview reports. A visit job, an exception or a completion moves
-- the item out of `open` and so out of the set.
-- Each item names its plan number, its plan's Einsatzort and the Anlagen of
-- its own plan revision that are neither archived nor voided, by name. The
-- organization's open items are walked by maintenance_due_work_queue_idx
-- (organization_id, status, due_date, id) in due-date order; the plan, the
-- site and the revision's Anlagen are probed by their keys, with the
-- organization checked beside each key. The other three sets stay as before,
-- and the result only gains a key, so the previous build reads it unchanged.
-- The array holds at most p_limit + 1 rows, so the caller sees an overflow
-- instead of a cut.
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
    ), '[]'::jsonb),
    'due_maintenance', coalesce((
      select jsonb_agg(to_jsonb(due_item) order by due_item.due_date, due_item.id)
      from (
        select
          due.id, due.due_date, plan.plan_number,
          (
            select site.name
            from public.client_sites site
            where site.id = plan.site_id and site.organization_id = p_organization_id
          ) as site_name,
          coalesce((
            select jsonb_agg(equipment.name order by equipment.name, equipment.id)
            from public.maintenance_plan_revision_equipment link
            join public.installed_equipment equipment
              on equipment.id = link.equipment_id and equipment.organization_id = p_organization_id
            where link.maintenance_plan_revision_id = due.maintenance_plan_revision_id
              and link.organization_id = p_organization_id
              and equipment.archived_at is null
              and equipment.voided_at is null
          ), '[]'::jsonb) as equipment_names
        from public.maintenance_due_work due
        join public.maintenance_plans plan
          on plan.id = due.maintenance_plan_id and plan.organization_id = p_organization_id
        where due.organization_id = p_organization_id
          and due.status = 'open'
          and due.due_date <= (now() at time zone 'Europe/Berlin')::date + 14
        order by due.due_date, due.id
        limit p_limit + 1
      ) due_item
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.read_manager_attention_sets(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_manager_attention_sets(uuid, integer) to service_role;
