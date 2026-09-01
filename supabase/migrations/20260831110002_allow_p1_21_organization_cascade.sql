create or replace function app_private.guard_time_capture_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
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
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'time_capture_append_only';
end;
$$;
