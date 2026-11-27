-- A correction request belongs to the employee record it was filed on. When
-- its subject no longer holds that record (the record lost its login, or the
-- login moved to a new record), the request is retained data of a removed
-- employee to that person (docs/technical/security.md, "Calendar correction
-- input boundary"): the history no longer lists it for its subject, nor for
-- its requester through `own`. An approver still lists it through `all` or
-- the employee subjects of `own_and_employee_subjects`: an open request
-- blocks its month's close, and a correction filed before an offboarding
-- still counts for payroll. The server applies the same rule to the approval
-- queue and „Vorgemerkte Zeit“ (`hydrateCorrectionRequests`,
-- lib/time-corrections/request-list.ts); the history applies it here, before
-- the count and the page boundary, so a page stays full and its total true.
--
-- Same signature, visibilities and result shape as
-- 20261004160100_paginate_time_correction_history.sql, so the previous
-- release keeps working against it.
create or replace function public.list_time_correction_history_page(
  p_organization_id uuid,
  p_caller_user_id uuid,
  p_visibility text,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as materialized (
    select request.id, request.created_at
    from public.time_correction_requests request
    cross join lateral (
      select app_private.is_p1_23_employee_record_actor(
        request.organization_id, request.subject_employee_record_id, request.subject_user_id
      ) as held
    ) subject
    where request.organization_id = p_organization_id
      and case p_visibility
        when 'all' then request.subject_user_id <> p_caller_user_id or subject.held
        when 'own' then
          (request.requested_by = p_caller_user_id or request.subject_user_id = p_caller_user_id)
          and subject.held
        when 'own_and_employee_subjects' then
          ((request.requested_by = p_caller_user_id or request.subject_user_id = p_caller_user_id) and subject.held)
          or (
            request.subject_user_id <> p_caller_user_id
            and exists (
              select 1 from public.organization_members member
              where member.organization_id = p_organization_id
                and member.user_id = request.subject_user_id
                and member.role = 'employee'
            )
          )
        else false
      end
  ), page as (
    select * from visible
    order by created_at desc, id
    limit least(greatest(coalesce(p_page_size, 50), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1)::bigint - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from visible),
    'ids', coalesce((select jsonb_agg(page.id order by page.created_at desc, page.id) from page), '[]')
  );
$$;
revoke all on function public.list_time_correction_history_page(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_time_correction_history_page(uuid, uuid, text, integer, integer) to service_role;

-- The Data API applies the same rule, with the same link check
-- (`is_p1_23_employee_record_actor`). A login reads a request, and with it
-- its revisions, sources, events and applications, as its subject or its
-- requester only while the subject holds the request's record. Admin, Büro
-- and time-approval holders read every request about someone else. `alter
-- policy` keeps the policy in place, so no reader is ever without one. On a
-- rolled-back build, an open „Vorgemerkte Zeit“ that still counts an
-- old-record request no longer hears its decision; its next read is correct.
-- @destructive: after release 8a73d1d0aa07: that build reads correction requests through the service role only and hears them over Realtime, so a login losing the Data API read of a record it no longer holds breaks none of its reads.
alter policy time_correction_requests_select_permitted
on public.time_correction_requests
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and (
    (
      (requested_by = (select auth.uid()) or subject_user_id = (select auth.uid()))
      and app_private.is_p1_23_employee_record_actor(organization_id, subject_employee_record_id, subject_user_id)
    )
    or (
      subject_user_id <> (select auth.uid())
      and (
        organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
        or app_private.is_time_approval_holder(organization_id, (select auth.uid()), subject_user_id)
      )
    )
  )
);
