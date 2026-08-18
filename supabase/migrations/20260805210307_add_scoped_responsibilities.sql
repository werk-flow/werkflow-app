
create type public.organization_responsibility as enum ('time_approval', 'leave_approval');
create type public.responsibility_configuration_mode as enum ('role_default', 'selected');
create type public.responsibility_assignment_source as enum ('role_default', 'direct');

create table public.organization_responsibility_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  responsibility public.organization_responsibility not null,
  mode public.responsibility_configuration_mode not null,
  effective_from timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index organization_responsibility_configurations_lookup_idx
  on public.organization_responsibility_configurations
  (organization_id, responsibility, effective_from desc, created_at desc);

create table public.organization_responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  configuration_id uuid not null references public.organization_responsibility_configurations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete restrict,
  source public.responsibility_assignment_source not null,
  role_snapshot public.org_role,
  created_at timestamptz not null default now(),
  unique (configuration_id, employee_record_id),
  check (
    (source = 'role_default' and role_snapshot in ('admin', 'buero'))
    or (source = 'direct' and role_snapshot is null)
  )
);

create index organization_responsibility_assignments_employee_idx
  on public.organization_responsibility_assignments (employee_record_id, configuration_id);

create table public.organization_responsibility_delegations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  responsibility public.organization_responsibility not null,
  delegator_employee_record_id uuid not null references public.employee_records(id) on delete restrict,
  substitute_employee_record_id uuid not null references public.employee_records(id) on delete restrict,
  valid_from date not null,
  valid_until date not null,
  revoked_from date,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delegator_employee_record_id <> substitute_employee_record_id),
  check (valid_until >= valid_from),
  check (revoked_from is null or revoked_from between valid_from and (valid_until + 1))
);

create index organization_responsibility_delegations_lookup_idx
  on public.organization_responsibility_delegations
  (organization_id, responsibility, valid_from, valid_until);

create table public.organization_responsibility_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  responsibility public.organization_responsibility not null,
  event_type text not null,
  configuration_id uuid references public.organization_responsibility_configurations(id) on delete set null,
  delegation_id uuid references public.organization_responsibility_delegations(id) on delete set null,
  primary_employee_record_id uuid references public.employee_records(id) on delete set null,
  related_employee_record_id uuid references public.employee_records(id) on delete set null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index organization_responsibility_events_org_created_idx
  on public.organization_responsibility_events (organization_id, created_at desc);

create or replace function app_private.validate_responsibility_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_responsibility_configurations c
    where c.id = new.configuration_id and c.organization_id = new.organization_id
  ) then
    raise exception 'responsibility_assignment_configuration_org_mismatch';
  end if;
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'responsibility_assignment_employee_org_mismatch';
  end if;
  return new;
end;
$$;

create trigger organization_responsibility_assignments_validate
before insert or update on public.organization_responsibility_assignments
for each row execute function app_private.validate_responsibility_assignment();

create or replace function app_private.validate_responsibility_delegation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.delegator_employee_record_id and er.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.employee_records er
    where er.id = new.substitute_employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'responsibility_delegation_employee_org_mismatch';
  end if;
  return new;
end;
$$;

create trigger organization_responsibility_delegations_validate
before insert or update on public.organization_responsibility_delegations
for each row execute function app_private.validate_responsibility_delegation();

create trigger organization_responsibility_delegations_updated_at
before update on public.organization_responsibility_delegations
for each row execute function public.update_updated_at_column();

create or replace function app_private.get_user_visible_responsibility_configuration_ids(
  p_user_id uuid default auth.uid()
)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct c.id
  from public.organization_responsibility_configurations c
  where c.organization_id in (
    select app_private.get_user_admin_or_manager_org_ids(p_user_id)
  )
  or exists (
    select 1
    from public.organization_responsibility_assignments a
    join public.employee_records er on er.id = a.employee_record_id
    where a.configuration_id = c.id and er.user_id = p_user_id
  )
  or exists (
    select 1
    from public.organization_responsibility_delegations d
    join public.employee_records delegator on delegator.id = d.delegator_employee_record_id
    join public.employee_records substitute on substitute.id = d.substitute_employee_record_id
    where d.organization_id = c.organization_id
      and d.responsibility = c.responsibility
      and (delegator.user_id = p_user_id or substitute.user_id = p_user_id)
  );
$$;

revoke all on function app_private.get_user_visible_responsibility_configuration_ids(uuid) from public;
grant execute on function app_private.get_user_visible_responsibility_configuration_ids(uuid)
to authenticated, service_role;

alter table public.organization_responsibility_configurations enable row level security;
alter table public.organization_responsibility_assignments enable row level security;
alter table public.organization_responsibility_delegations enable row level security;
alter table public.organization_responsibility_events enable row level security;

create policy "Managers or affected people can view responsibility configurations"
on public.organization_responsibility_configurations for select to authenticated
using (
  id in (
    select app_private.get_user_visible_responsibility_configuration_ids((select auth.uid()))
  )
);

create policy "Managers or affected people can view responsibility assignments"
on public.organization_responsibility_assignments for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

create policy "Managers or affected people can view responsibility delegations"
on public.organization_responsibility_delegations for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or delegator_employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
  or substitute_employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

create policy "Managers or affected people can view responsibility events"
on public.organization_responsibility_events for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or primary_employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
  or related_employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

revoke all on table
  public.organization_responsibility_configurations,
  public.organization_responsibility_assignments,
  public.organization_responsibility_delegations,
  public.organization_responsibility_events
from anon, authenticated;

grant select on table
  public.organization_responsibility_configurations,
  public.organization_responsibility_assignments,
  public.organization_responsibility_delegations,
  public.organization_responsibility_events
to authenticated;

grant all on table
  public.organization_responsibility_configurations,
  public.organization_responsibility_assignments,
  public.organization_responsibility_delegations,
  public.organization_responsibility_events
to service_role;

create unique index organization_members_one_admin_per_org_idx
  on public.organization_members (organization_id)
  where role = 'admin';

create or replace function app_private.protect_organization_owner_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  owner_user_id uuid;
begin
  select o.admin_id into owner_user_id
  from public.organizations o
  where o.id = coalesce(old.organization_id, new.organization_id);

  if tg_op = 'INSERT' then
    if (new.user_id = owner_user_id and new.role <> 'admin')
       or (new.role = 'admin' and new.user_id <> owner_user_id) then
      raise exception 'organization_owner_membership_mismatch';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.user_id = owner_user_id
       and (
         new.user_id is distinct from old.user_id
         or new.organization_id is distinct from old.organization_id
         or new.role <> 'admin'
       ) then
      raise exception 'organization_owner_is_protected';
    end if;
    if (new.user_id = owner_user_id and new.role <> 'admin')
       or (new.role = 'admin' and new.user_id <> owner_user_id) then
      raise exception 'organization_owner_membership_mismatch';
    end if;
    return new;
  end if;

  if old.user_id = owner_user_id
     and exists (select 1 from public.organizations o where o.id = old.organization_id) then
    raise exception 'organization_owner_is_protected';
  end if;
  return old;
end;
$$;

create trigger organization_members_protect_owner
before insert or update or delete on public.organization_members
for each row execute function app_private.protect_organization_owner_membership();

create or replace function app_private.block_organization_owner_transfer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.admin_id is distinct from old.admin_id then
    raise exception 'organization_owner_transfer_required';
  end if;
  return new;
end;
$$;

create trigger organizations_block_owner_transfer
before update of admin_id on public.organizations
for each row execute function app_private.block_organization_owner_transfer();

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

create trigger organization_members_protect_last_responsibility_holder
before update or delete on public.organization_members
for each row execute function app_private.protect_last_selected_responsibility_holder();

create or replace function app_private.append_role_default_responsibility_snapshot(
  p_organization_id uuid,
  p_responsibility public.organization_responsibility,
  p_actor_id uuid,
  p_reason text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  new_configuration_id uuid;
begin
  insert into public.organization_responsibility_configurations (
    organization_id, responsibility, mode, effective_from, created_by
  )
  values (
    p_organization_id, p_responsibility, 'role_default', clock_timestamp(), p_actor_id
  )
  returning id into new_configuration_id;

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
    jsonb_build_object('mode', 'role_default', 'reason', p_reason),
    p_actor_id
  );
  return new_configuration_id;
end;
$$;

revoke all on function app_private.append_role_default_responsibility_snapshot(
  uuid, public.organization_responsibility, uuid, text
) from public;

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

  foreach responsibility_value in array enum_range(null::public.organization_responsibility)
  loop
    select c.mode into current_mode
    from public.organization_responsibility_configurations c
    where c.organization_id = target_organization_id
      and c.responsibility = responsibility_value
      and c.effective_from <= now()
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

create trigger zzz_organization_members_refresh_role_default_responsibilities
after insert or update of role or delete on public.organization_members
for each row execute function app_private.refresh_role_default_responsibilities_after_membership();

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

revoke all on function public.apply_responsibility_configuration(
  uuid, public.organization_responsibility, public.responsibility_configuration_mode,
  uuid[], uuid, uuid
) from public, anon, authenticated;
grant execute on function public.apply_responsibility_configuration(
  uuid, public.organization_responsibility, public.responsibility_configuration_mode,
  uuid[], uuid, uuid
) to service_role;

create or replace function public.create_responsibility_delegation(
  p_organization_id uuid,
  p_responsibility public.organization_responsibility,
  p_delegator_employee_record_id uuid,
  p_substitute_employee_record_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_note text,
  p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  current_configuration_id uuid;
  new_delegation_id uuid;
  berlin_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_responsibility::text, 0)
  );

  if p_actor_id is distinct from (
    select o.admin_id from public.organizations o where o.id = p_organization_id
  ) then
    raise exception 'responsibility_configuration_admin_only';
  end if;

  if p_valid_from < berlin_today or p_valid_until < p_valid_from then
    raise exception 'responsibility_delegation_invalid_dates';
  end if;

  select c.id into current_configuration_id
  from public.organization_responsibility_configurations c
  where c.organization_id = p_organization_id
    and c.responsibility = p_responsibility
    and c.effective_from <= now()
  order by c.effective_from desc, c.created_at desc, c.id desc
  limit 1;

  if not exists (
    select 1 from public.organization_responsibility_assignments assignment
    where assignment.configuration_id = current_configuration_id
      and assignment.employee_record_id = p_delegator_employee_record_id
  ) then
    raise exception 'responsibility_delegator_not_current_holder';
  end if;

  if not exists (
    select 1
    from public.employee_records employee
    join public.organization_members member
      on member.organization_id = employee.organization_id
     and member.user_id = employee.user_id
    where employee.id = p_substitute_employee_record_id
      and employee.organization_id = p_organization_id
      and employee.exit_date is null
  ) then
    raise exception 'responsibility_substitute_not_active_member';
  end if;

  if p_delegator_employee_record_id = p_substitute_employee_record_id then
    raise exception 'responsibility_delegation_same_person';
  end if;

  if exists (
    select 1
    from public.organization_responsibility_delegations existing_delegation
    where existing_delegation.organization_id = p_organization_id
      and existing_delegation.responsibility = p_responsibility
      and existing_delegation.substitute_employee_record_id = p_substitute_employee_record_id
      and daterange(
        existing_delegation.valid_from,
        least(
          existing_delegation.valid_until + 1,
          coalesce(existing_delegation.revoked_from, existing_delegation.valid_until + 1)
        ),
        '[)'
      ) && daterange(p_valid_from, p_valid_until + 1, '[)')
  ) then
    raise exception 'responsibility_delegation_overlap';
  end if;

  insert into public.organization_responsibility_delegations (
    organization_id, responsibility, delegator_employee_record_id,
    substitute_employee_record_id, valid_from, valid_until, note, created_by
  )
  values (
    p_organization_id, p_responsibility, p_delegator_employee_record_id,
    p_substitute_employee_record_id, p_valid_from, p_valid_until,
    nullif(btrim(p_note), ''), p_actor_id
  )
  returning id into new_delegation_id;

  insert into public.organization_responsibility_events (
    organization_id, responsibility, event_type, delegation_id,
    primary_employee_record_id, related_employee_record_id, event_payload, created_by
  )
  values (
    p_organization_id,
    p_responsibility,
    'delegation_created',
    new_delegation_id,
    p_delegator_employee_record_id,
    p_substitute_employee_record_id,
    jsonb_build_object('valid_from', p_valid_from, 'valid_until', p_valid_until),
    p_actor_id
  );
  return new_delegation_id;
end;
$$;

revoke all on function public.create_responsibility_delegation(
  uuid, public.organization_responsibility, uuid, uuid, date, date, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_responsibility_delegation(
  uuid, public.organization_responsibility, uuid, uuid, date, date, text, uuid
) to service_role;

create or replace function public.end_responsibility_delegation(
  p_delegation_id uuid,
  p_revoked_from date,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  delegation_record public.organization_responsibility_delegations;
  berlin_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select * into delegation_record
  from public.organization_responsibility_delegations
  where id = p_delegation_id
  for update;

  if delegation_record.id is null then
    raise exception 'responsibility_delegation_not_found';
  end if;

  if p_actor_id is distinct from (
    select o.admin_id from public.organizations o
    where o.id = delegation_record.organization_id
  ) then
    raise exception 'responsibility_configuration_admin_only';
  end if;

  if p_revoked_from < berlin_today
     or p_revoked_from < delegation_record.valid_from
     or p_revoked_from > delegation_record.valid_until + 1 then
    raise exception 'responsibility_delegation_invalid_revocation_date';
  end if;

  update public.organization_responsibility_delegations
  set revoked_from = p_revoked_from
  where id = p_delegation_id;

  insert into public.organization_responsibility_events (
    organization_id, responsibility, event_type, delegation_id,
    primary_employee_record_id, related_employee_record_id, event_payload, created_by
  )
  values (
    delegation_record.organization_id,
    delegation_record.responsibility,
    'delegation_ended',
    delegation_record.id,
    delegation_record.delegator_employee_record_id,
    delegation_record.substitute_employee_record_id,
    jsonb_build_object('revoked_from', p_revoked_from),
    p_actor_id
  );
end;
$$;

revoke all on function public.end_responsibility_delegation(uuid, date, uuid)
from public, anon, authenticated;
grant execute on function public.end_responsibility_delegation(uuid, date, uuid)
to service_role;

do $$
declare
  organization_record record;
  responsibility_value public.organization_responsibility;
begin
  for organization_record in select o.id, o.admin_id from public.organizations o
  loop
    foreach responsibility_value in array enum_range(null::public.organization_responsibility)
    loop
      perform app_private.append_role_default_responsibility_snapshot(
        organization_record.id,
        responsibility_value,
        organization_record.admin_id,
        'p1_05_initial_snapshot'
      );
    end loop;
  end loop;
end;
$$;

alter table public.organization_responsibility_configurations replica identity full;
alter table public.organization_responsibility_assignments replica identity full;
alter table public.organization_responsibility_delegations replica identity full;

alter publication supabase_realtime add table
  public.organization_responsibility_configurations,
  public.organization_responsibility_assignments,
  public.organization_responsibility_delegations;
