-- Serialize equal operation identities before checking the operation ledger so
-- concurrent retries return the committed replay instead of racing its insert.
alter function public.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) set schema app_private;

revoke all on function app_private.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) from public, anon, authenticated, service_role;

create function public.transition_time_activity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_action public.time_operation_kind,
  p_expected_session_id uuid default null,
  p_expected_version bigint default null,
  p_segment_kind public.time_segment_kind default null,
  p_allocation_kind public.time_allocation_kind default null,
  p_job_id uuid default null,
  p_internal_type public.planning_internal_type default null,
  p_travel_route public.time_travel_route default null,
  p_travel_role public.time_travel_role default null,
  p_standby_context public.time_standby_context default null,
  p_acknowledge_long boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- Operation IDs are globally unique; serializing the same ID across tenants
  -- is intentional and keeps the public replay contract unambiguous.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );
  return app_private.transition_time_activity(
    p_organization_id,
    p_actor_id,
    p_operation_id,
    p_request_hash,
    p_action,
    p_expected_session_id,
    p_expected_version,
    p_segment_kind,
    p_allocation_kind,
    p_job_id,
    p_internal_type,
    p_travel_route,
    p_travel_role,
    p_standby_context,
    p_acknowledge_long
  );
end;
$$;

revoke all on function public.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) from public, anon, authenticated;
grant execute on function public.transition_time_activity(
  uuid, uuid, uuid, text, public.time_operation_kind, uuid, bigint,
  public.time_segment_kind, public.time_allocation_kind, uuid,
  public.planning_internal_type, public.time_travel_route,
  public.time_travel_role, public.time_standby_context, boolean
) to service_role;
