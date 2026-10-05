-- Creating, editing and dissolving a team, adding and ending a membership,
-- creating and retiring a capability definition and switching the apprentice
-- warning write the change and its history row together or not at all. The
-- server actions in lib/qualifications/actions.ts wrote teams, team_memberships,
-- organization_capabilities or organization_qualification_settings first and
-- inserted the team_events or qualification_events row in a second statement
-- whose failure was only logged, so a change could land without its history
-- row. The team, employee and membership pre-checks were separate reads before
-- the write, so a concurrent dissolve or edit could slip between them, and the
-- 'updated' history recorded the values read before the write.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the organization, validates the input and passes server-resolved
-- values. Each function locks the row it changes and the actor's membership,
-- repeats the state checks under those locks and raises the action failure
-- code of the first refusal, so nothing changes. The unique indexes
-- teams_active_name_unique and organization_capabilities_active_name_unique
-- decide a taken name; the exclusion constraint team_memberships_no_overlap
-- decides an overlapping membership.
--
-- Signals stay as before: the write to teams, team_memberships,
-- organization_capabilities or organization_qualification_settings reaches
-- their Realtime publication; team_events and qualification_events stay
-- unpublished.

-- The actor holds one of the roles in the organization until commit: a
-- removal or a role change waits for this call or makes it refuse.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.lock_qualification_actor(
  p_organization_id uuid,
  p_actor_id uuid,
  p_roles public.org_role[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role = any(p_roles)
  for share;
  if not found then raise exception 'not_authorized'; end if;
end;
$$;

-- Creates an active team and records 'created' with its name. Refusals:
-- invalid_input, not_authorized, duplicate_name. Returns the team id.
create function public.create_team(
  p_actor_id uuid,
  p_organization_id uuid,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_team_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or coalesce(btrim(p_name), '') = '' then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    insert into public.teams (organization_id, name, description, created_by, updated_by)
    values (p_organization_id, p_name, p_description, p_actor_id, p_actor_id)
    returning id into v_team_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'teams_active_name_unique' then raise exception 'duplicate_name'; end if;
    raise;
  end;

  insert into public.team_events (organization_id, team_id, event_type, event_payload, created_by)
  values (p_organization_id, v_team_id, 'created', jsonb_build_object('name', p_name), p_actor_id);

  return v_team_id;
end;
$$;

-- Renames an active team and records 'updated' with the name and description
-- before and after, read under the lock. Refusals: invalid_input,
-- team_not_found, not_authorized, duplicate_name.
create function public.update_team(
  p_actor_id uuid,
  p_organization_id uuid,
  p_team_id uuid,
  p_name text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.teams;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_team_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.teams team
  where team.organization_id = p_organization_id and team.id = p_team_id and team.dissolved_at is null
  for no key update;
  if not found then raise exception 'team_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);
  if coalesce(btrim(p_name), '') = '' then raise exception 'invalid_input'; end if;

  begin
    update public.teams team
    set name = p_name, description = p_description, updated_by = p_actor_id
    where team.organization_id = p_organization_id and team.id = p_team_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'teams_active_name_unique' then raise exception 'duplicate_name'; end if;
    raise;
  end;

  insert into public.team_events (organization_id, team_id, event_type, event_payload, created_by)
  values (
    p_organization_id, p_team_id, 'updated',
    jsonb_build_object('changes', jsonb_build_object(
      'name', jsonb_build_object('from', v_previous.name, 'to', p_name),
      'description', jsonb_build_object('from', v_previous.description, 'to', p_description)
    )),
    p_actor_id
  );
end;
$$;

-- Dissolves an active team and records 'dissolved' with the reason.
-- Refusals: invalid_input, team_not_found, not_authorized.
create function public.dissolve_team(
  p_actor_id uuid,
  p_organization_id uuid,
  p_team_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_actor_id is null or p_organization_id is null or p_team_id is null then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.teams team
  where team.organization_id = p_organization_id and team.id = p_team_id and team.dissolved_at is null
  for no key update;
  if not found then raise exception 'team_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  update public.teams team
  set dissolved_at = now(), updated_by = p_actor_id
  where team.organization_id = p_organization_id and team.id = p_team_id;

  insert into public.team_events (organization_id, team_id, event_type, event_payload, created_by)
  values (p_organization_id, p_team_id, 'dissolved', jsonb_build_object('reason', p_reason), p_actor_id);
end;
$$;

-- Adds an employee to an active team for the window and records
-- 'member_added'. The team stays active and the employee record stays until
-- commit. Refusals: invalid_input, team_not_found, not_authorized,
-- employee_not_found, overlap.
create function public.add_team_membership(
  p_actor_id uuid,
  p_organization_id uuid,
  p_team_id uuid,
  p_employee_record_id uuid,
  p_valid_from date,
  p_valid_until date
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_membership_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_team_id is null
    or p_employee_record_id is null or p_valid_from is null
    or (p_valid_until is not null and p_valid_until < p_valid_from)
  then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.teams team
  where team.organization_id = p_organization_id and team.id = p_team_id and team.dissolved_at is null
  for share;
  if not found then raise exception 'team_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);
  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_employee_record_id
  for key share;
  if not found then raise exception 'employee_not_found'; end if;

  begin
    insert into public.team_memberships (
      organization_id, team_id, employee_record_id, valid_from, valid_until, created_by
    ) values (
      p_organization_id, p_team_id, p_employee_record_id, p_valid_from, p_valid_until, p_actor_id
    )
    returning id into v_membership_id;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'team_memberships_no_overlap' then raise exception 'overlap'; end if;
    raise;
  end;

  insert into public.team_events (organization_id, team_id, event_type, event_payload, created_by)
  values (
    p_organization_id, p_team_id, 'member_added',
    jsonb_build_object(
      'membership_id', v_membership_id, 'employee_record_id', p_employee_record_id,
      'valid_from', p_valid_from, 'valid_until', p_valid_until
    ),
    p_actor_id
  );
end;
$$;

-- Ends a membership on the date and records 'member_ended' on its team.
-- Refusals: invalid_input, record_not_found, not_authorized.
create function public.end_team_membership(
  p_actor_id uuid,
  p_organization_id uuid,
  p_membership_id uuid,
  p_valid_until date
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_membership public.team_memberships;
begin
  if p_actor_id is null or p_organization_id is null or p_membership_id is null or p_valid_until is null then
    raise exception 'invalid_input';
  end if;

  select * into v_membership from public.team_memberships membership
  where membership.organization_id = p_organization_id and membership.id = p_membership_id
  for no key update;
  if not found then raise exception 'record_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);
  if p_valid_until < v_membership.valid_from then raise exception 'invalid_input'; end if;

  update public.team_memberships membership
  set valid_until = p_valid_until, ended_by = p_actor_id
  where membership.organization_id = p_organization_id and membership.id = p_membership_id;

  insert into public.team_events (organization_id, team_id, event_type, event_payload, created_by)
  values (
    p_organization_id, v_membership.team_id, 'member_ended',
    jsonb_build_object(
      'membership_id', p_membership_id, 'employee_record_id', v_membership.employee_record_id,
      'valid_until', p_valid_until
    ),
    p_actor_id
  );
end;
$$;

-- Creates a capability definition and records 'definition_created' with its
-- kind, name and warning days. Refusals: invalid_input, not_authorized,
-- duplicate_name. Returns the definition id.
create function public.create_capability_definition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_kind text,
  p_name text,
  p_description text,
  p_warning_days integer
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_capability_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_kind is null
    or p_kind not in ('skill', 'certification') or coalesce(btrim(p_name), '') = ''
    or p_warning_days is null or p_warning_days not between 0 and 365
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    insert into public.organization_capabilities (
      organization_id, kind, name, description, default_expiry_warning_days, created_by, updated_by
    ) values (
      p_organization_id, p_kind, p_name, p_description, p_warning_days, p_actor_id, p_actor_id
    )
    returning id into v_capability_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organization_capabilities_active_name_unique' then raise exception 'duplicate_name'; end if;
    raise;
  end;

  insert into public.qualification_events (
    organization_id, capability_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_capability_id, 'definition_created',
    jsonb_build_object('kind', p_kind, 'name', p_name, 'warning_days', p_warning_days),
    p_actor_id
  );

  return v_capability_id;
end;
$$;

-- Retires an active capability definition and records 'definition_retired'.
-- Refusals: invalid_input, definition_not_found, not_authorized.
create function public.retire_capability_definition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_capability_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_actor_id is null or p_organization_id is null or p_capability_id is null then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.organization_capabilities capability
  where capability.organization_id = p_organization_id and capability.id = p_capability_id
    and capability.retired_at is null
  for no key update;
  if not found then raise exception 'definition_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  update public.organization_capabilities capability
  set retired_at = now(), updated_by = p_actor_id
  where capability.organization_id = p_organization_id and capability.id = p_capability_id;

  insert into public.qualification_events (
    organization_id, capability_id, event_type, event_payload, created_by
  ) values (p_organization_id, p_capability_id, 'definition_retired', '{}'::jsonb, p_actor_id);
end;
$$;

-- Switches the organization's apprentice warning, creating its settings row
-- on first use, and records 'apprentice_warning_changed'. Admins only.
-- Refusals: invalid_input, not_authorized.
create function public.set_apprentice_warning_enabled(
  p_actor_id uuid,
  p_organization_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_actor_id is null or p_organization_id is null or p_enabled is null then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin']::public.org_role[]);

  insert into public.organization_qualification_settings (
    organization_id, apprentice_warning_enabled, created_by, updated_by
  ) values (p_organization_id, p_enabled, p_actor_id, p_actor_id)
  on conflict (organization_id) do update
  set apprentice_warning_enabled = excluded.apprentice_warning_enabled, updated_by = excluded.updated_by;

  insert into public.qualification_events (
    organization_id, capability_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, null, 'apprentice_warning_changed', jsonb_build_object('enabled', p_enabled), p_actor_id
  );
end;
$$;

revoke all on function app_private.lock_qualification_actor(uuid, uuid, public.org_role[])
  from public, anon, authenticated, service_role;
revoke all on function public.create_team(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_team(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.dissolve_team(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.add_team_membership(uuid, uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.end_team_membership(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.create_capability_definition(uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.retire_capability_definition(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_apprentice_warning_enabled(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.create_team(uuid, uuid, text, text) to service_role;
grant execute on function public.update_team(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.dissolve_team(uuid, uuid, uuid, text) to service_role;
grant execute on function public.add_team_membership(uuid, uuid, uuid, uuid, date, date) to service_role;
grant execute on function public.end_team_membership(uuid, uuid, uuid, date) to service_role;
grant execute on function public.create_capability_definition(uuid, uuid, text, text, text, integer)
  to service_role;
grant execute on function public.retire_capability_definition(uuid, uuid, uuid) to service_role;
grant execute on function public.set_apprentice_warning_enabled(uuid, uuid, boolean) to service_role;
