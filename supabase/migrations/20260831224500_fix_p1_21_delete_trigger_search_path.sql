-- Keep the organization-delete marker immune to caller-controlled schemas.
create or replace function app_private.mark_time_capture_organization_delete()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_marked_organization_ids text := coalesce(
    current_setting('app.time_capture_cascade_organization_ids', true), ''
  );
begin
  if not (old.id::text = any(string_to_array(v_marked_organization_ids, ','))) then
    v_marked_organization_ids := concat_ws(
      ',', nullif(v_marked_organization_ids, ''), old.id::text
    );
  end if;
  perform pg_catalog.set_config(
    'app.time_capture_cascade_organization_ids',
    v_marked_organization_ids,
    true
  );
  return old;
end;
$$;
