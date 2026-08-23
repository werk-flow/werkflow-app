grant execute on function app_private.assert_work_template_manager(uuid, uuid)
  to authenticated, service_role;
grant execute on function app_private.work_template_dependency_has_cycle(uuid)
  to authenticated, service_role;
