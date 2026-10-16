-- The attention counts run on every debounced Realtime event of every session,
-- so their reads must grow with the pending work, never with the
-- organization's history (lib/attention/count-volume.test.ts). Two reads could
-- not say "pending" through PostgREST filters:
--
-- 1. A dispatch stays active after its work is done, so the viewer's recipient
--    rows of current revisions grow with every dispatch they ever received.
--    list_pending_dispatch_recipients returns only the recipient
--    rows of a current revision of an active dispatch whose latest
--    acknowledgement by the viewer is not `acknowledged` or `carried_forward`.
--    lib/attention/actions.ts still derives the state from the same rows
--    (deriveRecipientState), so the tasks are the same; this only leaves out
--    rows that derivation drops. "Latest" orders as latestAcknowledgementByRecipient
--    does: the creation instant to the millisecond, then the id.
--
-- 2. The derived project handover needs the projects whose child jobs are all
--    terminal. Reading every terminal child job read every handed-over project.
--    list_handover_candidate_projects returns the projects without an
--    explicit execution state that have a terminal child job; a handed-over
--    project carries execution_state_override = 'handed_over' and drops out,
--    as the project read after it (`is('execution_state_override', null)`)
--    already required.
--
-- Service-role only: the caller resolves the organization, the viewer's own
-- employee record and the handover responsibility first.

create function public.list_pending_dispatch_recipients(
  p_organization_id uuid,
  p_employee_record_id uuid
) returns table (revision_id uuid, dispatch_id uuid)
language sql stable security invoker set search_path = '' as $$
  select recipient.revision_id, recipient.dispatch_id
  from public.planning_dispatch_recipients recipient
  join public.planning_dispatches dispatch
    on dispatch.id = recipient.dispatch_id
   and dispatch.organization_id = p_organization_id
   and dispatch.status = 'active'
   and dispatch.current_revision_id = recipient.revision_id
  where recipient.organization_id = p_organization_id
    and recipient.employee_record_id = p_employee_record_id
    and coalesce(
      (
        select acknowledgement.state::text
        from public.planning_dispatch_acknowledgements acknowledgement
        where acknowledgement.organization_id = p_organization_id
          and acknowledgement.revision_id = recipient.revision_id
          and acknowledgement.employee_record_id = p_employee_record_id
        order by date_trunc('milliseconds', acknowledgement.created_at) desc, acknowledgement.id desc
        limit 1
      ),
      'none'
    ) not in ('acknowledged', 'carried_forward')
  order by recipient.id
$$;

revoke all on function public.list_pending_dispatch_recipients(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_pending_dispatch_recipients(uuid, uuid) to service_role;

create function public.list_handover_candidate_projects(
  p_organization_id uuid
) returns table (project_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct job.project_id
  from public.jobs job
  join public.projects project
    on project.id = job.project_id
   and project.organization_id = p_organization_id
   and project.execution_state_override is null
  where job.organization_id = p_organization_id
    and (
      job.execution_state in ('execution_complete', 'handed_over', 'cancelled')
      or (job.execution_state is null and job.status = 'fertig')
    )
  order by job.project_id
$$;

revoke all on function public.list_handover_candidate_projects(uuid) from public, anon, authenticated;
grant execute on function public.list_handover_candidate_projects(uuid) to service_role;
