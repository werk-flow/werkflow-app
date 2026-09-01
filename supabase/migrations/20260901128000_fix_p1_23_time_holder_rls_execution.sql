-- P1-23 RLS policies call this private helper for authenticated readers. The
-- helper is outside the exposed API schema, but PostgreSQL still requires the
-- caller to have EXECUTE while evaluating the policy.
grant execute on function app_private.is_p1_23_time_holder(uuid, uuid) to authenticated;

drop policy time_period_close_versions_managers_select
  on public.time_period_close_versions;

create policy time_period_close_versions_managers_select
  on public.time_period_close_versions
  for select
  to authenticated
  using (
    organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or app_private.is_p1_23_time_holder(
      organization_id,
      (select auth.uid())
    )
    or exists (
      select 1
      from public.time_period_employee_results result
      where result.calculation_id = time_period_close_versions.calculation_id
        and exists (
          select 1
          from public.employee_records employee
          where employee.id = result.employee_record_id
            and employee.user_id = (select auth.uid())
        )
    )
  );
