create or replace function app_private.prevent_work_template_history_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Foreign-key cascades intentionally remove history with its owning work or
  -- organization. A direct update/delete still reaches this trigger at depth 1.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'work_template_history_immutable';
end;
$$;
