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
-- first to commit. Its read, a new statement under read committed, sees the
-- result, and it compares effective_from with clock_timestamp(), not with
-- now(), which is the start of its own transaction and would hide a
-- configuration saved while it waited. So the second removal finds no other
-- holder and refuses, and the redemption finds the selected group and
-- appends nothing.
--
-- Lock order: a member's row, then the organization lock, then personnel
-- records. A role-default snapshot and the save take a key share lock on
-- holders' personnel records through their foreign keys after the
-- organization lock. So the member removal, which locks the removed
-- person's record FOR UPDATE (also in close_time_session_for_member_removal),
-- now takes the organization lock right after it locks the membership and
-- before that record. Otherwise two Büro removals, or a removal and a save
-- or delegation naming that person, waited for each other. A role change
-- locks only its member row before the trigger takes the organization lock,
-- the same order. The save takes the organization lock before its
-- per-responsibility lock, which delegations share; nothing takes the two in
-- the other order. An organization deletion locks the organization row
-- first, so the last-holder trigger skips the lock for a member deleted with
-- its organization, as the refresh already returns early there.
--
-- The signatures, the checks, the results and the grants stay as before
-- (the last-holder trigger and the save from
-- 20260805210307_add_scoped_responsibilities.sql, the refresh from
-- 20260805212958_guard_responsibility_snapshot_on_org_delete.sql, the removal
-- from 20261004130000_remove_member_with_exit_atomically.sql).

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

  if exists (
    select 1 from public.organizations organization
    where organization.id = old.organization_id
  ) then
    perform pg_advisory_xact_lock(
      hashtextextended(old.organization_id::text || ':responsibility-holders', 0)
    );
  end if;

  with latest as (
    select distinct on (c.responsibility) c.id, c.responsibility, c.mode
    from public.organization_responsibility_configurations c
    where c.organization_id = old.organization_id and c.effective_from <= clock_timestamp()
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
    and c.effective_from <= clock_timestamp()
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

create or replace function public.remove_member_with_time_capture(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
set search_path to ''
as $$
declare
  -- The Europe/Berlin business date, as getBusinessTodayIso in TypeScript.
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_canonical_closed boolean;
  v_record_id uuid;
  v_entry_date date;
  v_exit_date date;
begin
  perform 1 from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id
  for update;
  if not found then raise exception 'time_member_removal_target_missing'; end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':responsibility-holders', 0)
  );

  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.user_id = p_target_user_id
  ) or exists (
    select 1 from public.time_sessions session
    where session.organization_id = p_organization_id
      and session.user_id = p_target_user_id
  ) then raise exception 'time_member_removal_has_history'; end if;

  select employee.id, employee.entry_date, employee.exit_date
  into v_record_id, v_entry_date, v_exit_date
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id = p_target_user_id
  for update;
  -- A person whose entry lies after today cannot exit today; refuse before
  -- anything changes instead of dropping the exit date.
  if v_record_id is not null
    and (v_exit_date is null or v_exit_date >= v_today)
    and v_entry_date > v_today
  then raise exception 'member_removal_exit_before_entry'; end if;

  v_canonical_closed := coalesce(public.close_time_session_for_member_removal(
    p_organization_id, p_target_user_id, p_actor_id, p_operation_id
  ), false);

  delete from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id;
  if not found then raise exception 'time_member_removal_target_missing'; end if;

  -- The personnel record survives the removal and is marked as exited, so the
  -- person stays distinguishable in history (P1-03, owner-approved).
  if v_record_id is not null and (v_exit_date is null or v_exit_date >= v_today) then
    update public.employee_records employee
    set exit_date = v_today
    where employee.id = v_record_id and employee.organization_id = p_organization_id;
    insert into public.employee_record_events (
      organization_id, employee_record_id, event_type, event_payload, created_by
    ) values (
      p_organization_id, v_record_id, 'membership_removed',
      jsonb_build_object('exit_date', v_today, 'auto_clocked_out', v_canonical_closed),
      p_actor_id
    );
  end if;

  return v_canonical_closed;
end;
$$;
