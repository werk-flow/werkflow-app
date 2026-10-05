-- One bounded page of the correction history in Zeiterfassung. The history
-- grows with the organization, so the visibility rule, the count and the
-- page boundary apply here instead of after a complete read. Newest request
-- first, ties by id. Service-role only: the server action establishes the
-- caller, the membership and the effective time-approval holder, and passes
-- the resolved visibility:
--
-- * `all`: an admin or Büro member, or an employee whose approval reaches
--   every role. Every request of the organization.
-- * `own`: an employee who reviews nobody. The requests the caller filed or
--   is the subject of.
-- * `own_and_employee_subjects`: an employee who holds time approval through
--   a Büro source. Their own requests and those of every subject who is an
--   employee member of the organization.
--
-- An unknown visibility lists nothing.
create function public.list_time_correction_history_page(
  p_organization_id uuid,
  p_caller_user_id uuid,
  p_visibility text,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as materialized (
    select request.id, request.created_at
    from public.time_correction_requests request
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
