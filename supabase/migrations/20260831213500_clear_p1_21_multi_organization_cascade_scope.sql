-- Limit the multi-organization cascade marker to the parent DELETE statement.

create or replace function app_private.clear_time_capture_organization_delete()
returns trigger
language plpgsql
security invoker
as $$
begin
  perform pg_catalog.set_config(
    'app.time_capture_cascade_organization_ids', '', true
  );
  return null;
end;
$$;

drop trigger if exists clear_p1_21_time_capture_organization_delete
on public.organizations;
create trigger clear_p1_21_time_capture_organization_delete
after delete on public.organizations
for each statement execute function app_private.clear_time_capture_organization_delete();

revoke all on function app_private.clear_time_capture_organization_delete()
from public, anon, authenticated;
grant execute on function app_private.clear_time_capture_organization_delete()
to postgres, service_role;
