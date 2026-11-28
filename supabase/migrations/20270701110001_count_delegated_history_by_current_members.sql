-- An employee whose time approval reaches every role (an admin source or a
-- direct assignment) sees another person's correction request only while its
-- subject is a member of the organization: the server checks their
-- responsibility against the subject's membership role (`holderCovers`,
-- lib/time-corrections/request-list.ts). With `all`, the history counted and
-- paged a former member's request it then hid, so the total was too high and
-- a page came back short or empty. `own_and_member_subjects` applies the
-- server's rule before the count and the page boundary: their own requests
-- while the subject holds the record, and every request about another person
-- who still has a membership, of any role. A former member's request stays
-- hidden from them; Admin and Büro keep `all`.
--
-- Same signature, grants, `security invoker` and result shape as
-- 20270701090003_list_correction_history_of_effective_subjects.sql, and every
-- earlier visibility unchanged, so the previous release keeps working against it.
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
        when 'own_and_member_subjects' then
          ((request.requested_by = p_caller_user_id or request.subject_user_id = p_caller_user_id) and subject.held)
          or (
            request.subject_user_id <> p_caller_user_id
            and exists (
              select 1 from public.organization_members member
              where member.organization_id = p_organization_id
                and member.user_id = request.subject_user_id
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
