-- Keep the statement-level organization-delete cleanup immune to caller-controlled schemas.
create or replace function app_private.clear_time_capture_organization_delete()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform pg_catalog.set_config(
    'app.time_capture_cascade_organization_ids', '', true
  );
  return null;
end;
$$;
