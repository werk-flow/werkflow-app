-- Creating an organization is one transaction. The server action
-- createOrganization (lib/org/actions.ts) inserted the organization, then its
-- settings, then read the owner membership, and on a later failure deleted the
-- organization again without checking that delete. A failed settings insert
-- or a missing membership could leave an organization without settings or
-- without its owner. The function now writes everything or nothing.
--
-- The action establishes identity and the subscription, normalizes and checks
-- the name, and draws the organization code. The insert triggers add the
-- owner membership (and through it the personnel record and the role default
-- responsibilities) and the inventory defaults, all inside this transaction.
-- Refusals: name_taken (the owner already has an organization of that name),
-- member_creation_failed (the owner membership is missing after the insert).
-- Returns the new organization's id.
create function public.create_organization_with_defaults(
  p_admin_id uuid,
  p_name text,
  p_unique_code text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_created_at timestamptz;
  v_constraint text;
begin
  begin
    insert into public.organizations (name, admin_id, unique_code)
    values (p_name, p_admin_id, p_unique_code)
    returning id, created_at into v_organization_id, v_created_at;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organizations_admin_id_normalized_name_key' then
      raise exception 'name_taken';
    end if;
    raise;
  end;

  -- The default break policy and its first history entry. effectiveFrom uses
  -- the ISO form with Z that the history parser in lib/time-tracking/settings.ts
  -- accepts.
  insert into public.organization_settings (
    organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes,
    break_policy_history
  ) values (
    v_organization_id, 'manual', 360, 30,
    jsonb_build_array(jsonb_build_object(
      'breakMode', 'manual',
      'autoBreakThresholdMinutes', 360,
      'autoBreakDurationMinutes', 30,
      'effectiveFrom', to_char(v_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ))
  );

  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = v_organization_id
      and membership.user_id = p_admin_id
      and membership.role = 'admin'
  ) then
    raise exception 'member_creation_failed';
  end if;

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization_with_defaults(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_with_defaults(uuid, text, text) to service_role;
