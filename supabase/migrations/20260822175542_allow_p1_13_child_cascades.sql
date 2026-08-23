create or replace function app_private.validate_work_template_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child_organization_id uuid;
  child_version_id uuid;
  version_status text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' then
    child_organization_id := old.organization_id;
    child_version_id := old.version_id;
  else
    child_organization_id := new.organization_id;
    child_version_id := new.version_id;
  end if;

  select version.status into version_status
  from public.work_template_versions version
  where version.id = child_version_id
    and version.organization_id = child_organization_id;

  if version_status is null then
    raise exception 'work_template_child_organization_mismatch';
  end if;
  if version_status <> 'draft' then
    raise exception 'published_work_template_version_immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
