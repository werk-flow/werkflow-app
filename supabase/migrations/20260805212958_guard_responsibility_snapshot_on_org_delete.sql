
create or replace function app_private.refresh_role_default_responsibilities_after_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  responsibility_value public.organization_responsibility;
  current_mode public.responsibility_configuration_mode;
begin
  if tg_op = 'INSERT' and new.role not in ('admin', 'buero') then return new; end if;
  if tg_op = 'DELETE' and old.role not in ('admin', 'buero') then return old; end if;
  if tg_op = 'UPDATE'
     and old.role not in ('admin', 'buero')
     and new.role not in ('admin', 'buero') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
  else
    target_organization_id := new.organization_id;
  end if;

  if not exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  foreach responsibility_value in array enum_range(null::public.organization_responsibility)
  loop
    select c.mode into current_mode
    from public.organization_responsibility_configurations c
    where c.organization_id = target_organization_id
      and c.responsibility = responsibility_value
      and c.effective_from <= clock_timestamp()
    order by c.effective_from desc, c.created_at desc, c.id desc
    limit 1;

    if current_mode is null or current_mode = 'role_default' then
      perform app_private.append_role_default_responsibility_snapshot(
        target_organization_id, responsibility_value, null, 'membership_role_changed'
      );
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
