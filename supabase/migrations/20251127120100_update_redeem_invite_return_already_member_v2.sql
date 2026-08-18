-- Drop and recreate the redeem_organization_invite function with already_member return value
DROP FUNCTION IF EXISTS public.redeem_organization_invite(text);

CREATE FUNCTION public.redeem_organization_invite(p_invite_code text)
RETURNS TABLE(org_id uuid, org_name text, already_member boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_admin_id uuid;
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_org_name text;
  v_already_member boolean := false;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- lock invite row and validate
  select i.organization_id
       , o.admin_id
       , o.name
  into v_org_id, v_admin_id, v_org_name
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.invite_code = p_invite_code
  for update;

  if v_org_id is null then
    raise exception 'invalid_invite';
  end if;

  -- validate status and expiry
  if exists (
    select 1 from public.organization_invites i
    where i.invite_code = p_invite_code
      and (i.status <> 'pending' or i.expires_at < v_now)
  ) then
    raise exception 'invite_not_redeemable';
  end if;

  -- Check if user is already a member of this organization
  if exists (
    select 1 from public.organization_members m
    where m.user_id = v_user_id and m.organization_id = v_org_id
  ) then
    v_already_member := true;
    -- Don't mark invite as accepted if user is already a member
    -- Just return the org info with already_member flag
    return query select v_org_id as org_id, v_org_name as org_name, v_already_member as already_member;
    return;
  end if;

  -- ownership compatibility: all existing orgs must share same admin as target
  if exists (
    select 1
    from public.organization_members m
    join public.organizations o2 on o2.id = m.organization_id
    where m.user_id = v_user_id
      and o2.admin_id <> v_admin_id
  ) then
    raise exception 'admin_mismatch';
  end if;

  -- add membership as employee
  insert into public.organization_members (user_id, organization_id, role)
  values (v_user_id, v_org_id, 'employee');

  -- mark invite accepted
  update public.organization_invites
    set status = 'accepted', accepted_at = v_now
  where invite_code = p_invite_code;

  -- Return the result
  return query select v_org_id as org_id, v_org_name as org_name, v_already_member as already_member;
end;$function$;