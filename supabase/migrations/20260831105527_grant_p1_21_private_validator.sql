grant execute on function app_private.validate_time_segment_input(
  uuid, uuid, public.org_role, public.time_segment_kind,
  public.time_allocation_kind, uuid, public.planning_internal_type,
  public.time_travel_route, public.time_travel_role,
  public.time_standby_context
) to service_role;
