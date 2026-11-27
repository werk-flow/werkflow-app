-- The correction history lists only the requests whose subject still holds
-- the employee record the request was filed on. A request of a record its
-- person no longer holds (the record lost its login, or the login moved to a
-- new record) is retained data of a removed employee
-- (docs/technical/security.md, "Calendar correction input boundary"). The
-- approval queue and „Vorgemerkte Zeit“ apply the same rule on the server
-- (`hasEffectiveSubject`, lib/time-corrections/request-list.ts); the history
-- applies it here, before the count and the page boundary, so a page stays
-- full and its total true.
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
    join public.employee_records subject_record
      on subject_record.id = request.subject_employee_record_id
     and subject_record.organization_id = request.organization_id
     and subject_record.user_id = request.subject_user_id
    where request.organization_id = p_organization_id
      and case p_visibility
        when 'all' then true
        when 'own' then request.requested_by = p_caller_user_id or request.subject_user_id = p_caller_user_id
        when 'own_and_employee_subjects' then
          request.requested_by = p_caller_user_id
          or request.subject_user_id = p_caller_user_id
          or exists (
            select 1 from public.organization_members member
            where member.organization_id = p_organization_id
              and member.user_id = request.subject_user_id
              and member.role = 'employee'
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
