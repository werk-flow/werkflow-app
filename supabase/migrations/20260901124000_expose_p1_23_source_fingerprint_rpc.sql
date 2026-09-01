-- Server orchestration computes period payloads in TypeScript, then sends the
-- live database fingerprint back to the atomic preparation RPC. Keep the raw
-- helper private and expose only this service-role, manager-authorized seam.

create or replace function public.get_time_period_source_fingerprint(
  p_actor_id uuid,
  p_organization_id uuid
) returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  return app_private.compute_p1_23_source_fingerprint(p_organization_id);
end;
$$;

revoke all on function public.get_time_period_source_fingerprint(uuid, uuid) from public;
grant execute on function public.get_time_period_source_fingerprint(uuid, uuid) to service_role;
