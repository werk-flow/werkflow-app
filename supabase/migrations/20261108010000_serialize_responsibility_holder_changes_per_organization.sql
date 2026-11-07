-- Three paths change who holds an organization's responsibilities: the owner's
-- save of a configuration, a member removal that checks for the last holder of
-- a selected group, and the role-default snapshot appended when an Admin or
-- Büro membership appears, changes role or goes. Only the save took a lock,
-- and only one per responsibility. So two removals could each count the other
-- as the remaining holder and both commit, leaving a selected group without an
-- active holder. And a Büro invite redeemed while the owner saved a selected
-- group could read the old role-default mode and append a role-default
-- snapshot after the owner's selection, which then lost.
--
-- All three now take one advisory lock per organization before they read the
-- current configuration. The second of two concurrent changes waits for the
-- first to commit, and its read, a new statement under read committed, sees
-- the result: the second removal finds no other holder and refuses, and the
-- redemption finds the selected group and appends nothing.
--
-- Every path takes its row locks before the organization lock. The triggers
-- reach the lock after their statement and the function around it have
-- locked rows: a removal locks the person's personnel record FOR UPDATE, an
-- organization deletion the organization row. The save's inserts take a key
-- share lock on the organization and on each holder's personnel record
-- through their foreign keys, so the save takes those row locks first and
-- the organization lock after them. Taken after the organization lock, they
-- waited for a removal that itself waited for the organization lock. The
-- save then takes its per-responsibility lock, which delegations share;
-- nothing takes the two in the other order.
--
-- The signatures, the checks, the results and the grants stay as before
-- (the last-holder trigger and the save from
-- 20260805210307_add_scoped_responsibilities.sql, the refresh from
-- 20260805212958_guard_responsibility_snapshot_on_org_delete.sql).

create or replace function app_private.protect_last_selected_responsibility_holder()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  removed_employee_record_id uuid;
  stranded_responsibility public.organization_responsibility;
begin
  if tg_op = 'UPDATE'
     and new.user_id is not distinct from old.user_id
     and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  select er.id into removed_employee_record_id
  from public.employee_records er
  where er.organization_id = old.organization_id and er.user_id = old.user_id;

  if removed_employee_record_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(old.organization_id::text || ':responsibility-holders', 0)
  );

  with latest as (
    select distinct on (c.responsibility) c.id, c.responsibility, c.mode
    from public.organization_responsibility_configurations c
    where c.organization_id = old.organization_id and c.effective_from <= now()
    order by c.responsibility, c.effective_from desc, c.created_at desc, c.id desc
  )
  select l.responsibility into stranded_responsibility
  from latest l
  where l.mode = 'selected'
    and exists (
      select 1 from public.organization_responsibility_assignments own_assignment
      where own_assignment.configuration_id = l.id
        and own_assignment.employee_record_id = removed_employee_record_id
    )
    and not exists (
      select 1
      from public.organization_responsibility_assignments other_assignment
      join public.employee_records other_record
        on other_record.id = other_assignment.employee_record_id
      join public.organization_members other_member
        on other_member.organization_id = other_record.organization_id
       and other_member.user_id = other_record.user_id
      where other_assignment.configuration_id = l.id
        and other_assignment.employee_record_id <> removed_employee_record_id
        and other_record.exit_date is null
    )
  limit 1;

  if stranded_responsibility is not null then
    raise exception 'last_responsibility_holder:%', stranded_responsibility;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

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

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':responsibility-holders', 0)
  );

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

create or replace function public.apply_responsibility_configuration(
  p_organization_id uuid,
  p_responsibility public.organization_responsibility,
  p_mode public.responsibility_configuration_mode,
  p_employee_record_ids uuid[],
  p_actor_id uuid,
  p_expected_configuration_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  current_configuration_id uuid;
  new_configuration_id uuid;
  holder_id uuid;
begin
  perform 1 from public.organizations organization
  where organization.id = p_organization_id
  for key share;
  perform 1
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and (
      (p_mode = 'selected' and employee.id = any(p_employee_record_ids))
      or (p_mode = 'role_default' and exists (
        select 1 from public.organization_members member
        where member.organization_id = employee.organization_id
          and member.user_id = employee.user_id
          and member.role in ('admin', 'buero')
      ))
    )
  order by employee.id
  for key share;
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':responsibility-holders', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_responsibility::text, 0)
  );

  if p_actor_id is distinct from (
    select o.admin_id from public.organizations o where o.id = p_organization_id
  ) then
    raise exception 'responsibility_configuration_admin_only';
  end if;

  select c.id into current_configuration_id
  from public.organization_responsibility_configurations c
  where c.organization_id = p_organization_id
    and c.responsibility = p_responsibility
    and c.effective_from <= now()
  order by c.effective_from desc, c.created_at desc, c.id desc
  limit 1;

  if current_configuration_id is distinct from p_expected_configuration_id then
    raise exception 'responsibility_configuration_changed';
  end if;

  if p_mode = 'selected'
     and coalesce(array_length(p_employee_record_ids, 1), 0) = 0 then
    raise exception 'responsibility_requires_active_holder';
  end if;

  if p_mode = 'selected' and exists (
    select 1
    from unnest(p_employee_record_ids) requested(employee_record_id)
    where not exists (
      select 1
      from public.employee_records employee
      join public.organization_members member
        on member.organization_id = employee.organization_id
       and member.user_id = employee.user_id
      where employee.id = requested.employee_record_id
        and employee.organization_id = p_organization_id
        and employee.exit_date is null
    )
  ) then
    raise exception 'responsibility_holder_not_active_member';
  end if;

  insert into public.organization_responsibility_configurations (
    organization_id, responsibility, mode, effective_from, created_by
  )
  values (
    p_organization_id, p_responsibility, p_mode, clock_timestamp(), p_actor_id
  )
  returning id into new_configuration_id;

  if p_mode = 'role_default' then
    insert into public.organization_responsibility_assignments (
      organization_id, configuration_id, employee_record_id, source, role_snapshot
    )
    select
      member.organization_id, new_configuration_id, employee.id, 'role_default', member.role
    from public.organization_members member
    join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
    where member.organization_id = p_organization_id
      and member.role in ('admin', 'buero')
      and employee.exit_date is null;
  else
    foreach holder_id in array p_employee_record_ids
    loop
      insert into public.organization_responsibility_assignments (
        organization_id, configuration_id, employee_record_id, source
      )
      values (
        p_organization_id, new_configuration_id, holder_id, 'direct'
      )
      on conflict (configuration_id, employee_record_id) do nothing;
    end loop;
  end if;

  if not exists (
    select 1 from public.organization_responsibility_assignments assignment
    where assignment.configuration_id = new_configuration_id
  ) then
    raise exception 'responsibility_requires_active_holder';
  end if;

  insert into public.organization_responsibility_events (
    organization_id, responsibility, event_type, configuration_id, event_payload, created_by
  )
  values (
    p_organization_id,
    p_responsibility,
    'configuration_changed',
    new_configuration_id,
    jsonb_build_object('mode', p_mode, 'holder_employee_record_ids', to_jsonb(p_employee_record_ids)),
    p_actor_id
  );
  return new_configuration_id;
end;
$$;
