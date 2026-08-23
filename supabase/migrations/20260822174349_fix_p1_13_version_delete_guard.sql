create or replace function app_private.guard_published_work_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if old.status = 'published' then
      raise exception 'published_work_template_version_immutable';
    end if;
    return old;
  end if;

  if old.status = 'published' then
    raise exception 'published_work_template_version_immutable';
  end if;
  return new;
end;
$$;
