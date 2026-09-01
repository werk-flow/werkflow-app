-- A single DELETE statement may remove several organizations. PostgreSQL runs
-- every row-level BEFORE trigger before the deferred FK cascades, so retain
-- every exact organization marker instead of only the final row's identifier.

create or replace function app_private.mark_time_capture_organization_delete()
returns trigger
language plpgsql
security invoker
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

create or replace function app_private.guard_time_capture_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE'
    and old.organization_id::text = any(string_to_array(coalesce(
      current_setting('app.time_capture_cascade_organization_ids', true), ''
    ), ','))
  then return old; end if;
  if current_setting('app.time_capture_write', true) is distinct from 'true' then
    raise exception 'time_capture_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.guard_time_capture_append_only()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE'
    and old.organization_id::text = any(string_to_array(coalesce(
      current_setting('app.time_capture_cascade_organization_ids', true), ''
    ), ','))
  then return old; end if;
  raise exception 'time_capture_append_only';
end;
$$;

revoke all on function app_private.mark_time_capture_organization_delete()
from public, anon, authenticated;
grant execute on function app_private.mark_time_capture_organization_delete()
to postgres, service_role;
