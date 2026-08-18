create or replace function app_private.check_user_exists_by_email(p_email text)
returns table(user_id uuid, user_exists boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select u.id as user_id, true as user_exists
  from auth.users u
  where u.email = lower(p_email)
  limit 1;

  if not found then
    return query select null::uuid as user_id, false as user_exists;
  end if;
end;
$$;

create or replace function app_private.get_invite_by_code(p_invite_code text)
returns table(
  id uuid,
  organization_id uuid,
  email text,
  status invite_status,
  expires_at timestamptz,
  org_name text,
  invited_role org_role
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id,
         i.organization_id,
         i.email,
         i.status,
         i.expires_at,
         o.name as org_name,
         i.invited_role
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.invite_code = p_invite_code;
$$;

create or replace function app_private.get_org_members_for_user(p_org_id uuid, p_user_id uuid)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  role org_role,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or not exists (
    select 1
    from public.organization_members om
    where om.user_id = p_user_id
      and om.organization_id = p_org_id
  ) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.user_id,
           coalesce(p.first_name, '')::text,
           coalesce(p.last_name, '')::text,
           u.email::text,
           m.role,
           m.joined_at
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org_id
    order by
      case m.role
        when 'admin' then 1
        when 'buero' then 2
        when 'employee' then 3
        else 4
      end,
      coalesce(p.last_name, '') asc,
      coalesce(p.first_name, '') asc;
end;
$$;

create or replace function app_private.redeem_organization_invite_for_user(p_invite_code text, p_user_id uuid)
returns table(org_id uuid, org_name text, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_admin_id uuid;
  v_now timestamptz := now();
  v_user_id uuid := p_user_id;
  v_user_email text;
  v_invite_email text;
  v_org_name text;
  v_already_member boolean := false;
  v_invite_status text;
  v_expires_at timestamptz;
  v_invited_role org_role;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_user_email
  from auth.users
  where id = v_user_id;

  if v_user_email is null then
    raise exception 'not_authenticated';
  end if;

  select i.organization_id,
         o.admin_id,
         o.name,
         i.status,
         i.expires_at,
         i.email,
         i.invited_role
  into v_org_id, v_admin_id, v_org_name, v_invite_status, v_expires_at, v_invite_email, v_invited_role
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.invite_code = p_invite_code;

  if v_org_id is null then
    raise exception 'invalid_invite';
  end if;

  if lower(v_user_email) <> lower(v_invite_email) then
    raise exception 'email_mismatch::%', v_invite_email;
  end if;

  if exists (
    select 1
    from public.organization_members m
    where m.user_id = v_user_id
      and m.organization_id = v_org_id
  ) then
    v_already_member := true;
    return query select v_org_id, v_org_name, v_already_member;
    return;
  end if;

  if v_expires_at < v_now then
    raise exception 'invite_expired';
  end if;

  if v_invite_status = 'cancelled' then
    raise exception 'invite_cancelled';
  end if;

  if v_invite_status <> 'pending' then
    raise exception 'invite_already_used';
  end if;

  if exists (
    select 1
    from public.organization_members m
    join public.organizations o2 on o2.id = m.organization_id
    where m.user_id = v_user_id
      and o2.admin_id <> v_admin_id
  ) then
    raise exception 'admin_mismatch';
  end if;

  perform 1
  from public.organization_invites
  where invite_code = p_invite_code
  for update;

  insert into public.organization_members (user_id, organization_id, role)
  values (v_user_id, v_org_id, coalesce(v_invited_role, 'employee'));

  update public.organization_invites
    set status = 'accepted', accepted_at = v_now
  where invite_code = p_invite_code;

  return query select v_org_id, v_org_name, v_already_member;
end;
$$;

create or replace function public.check_user_exists_by_email(p_email text)
returns table(user_id uuid, user_exists boolean)
language sql
security invoker
set search_path = public, app_private
as $$
  select * from app_private.check_user_exists_by_email(p_email);
$$;

create or replace function public.get_invite_by_code(p_invite_code text)
returns table(
  id uuid,
  organization_id uuid,
  email text,
  status invite_status,
  expires_at timestamptz,
  org_name text,
  invited_role org_role
)
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select * from app_private.get_invite_by_code(p_invite_code);
$$;

create or replace function public.get_org_members(p_org_id uuid)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  role org_role,
  joined_at timestamptz
)
language sql
security invoker
set search_path = public, app_private
as $$
  select * from app_private.get_org_members_for_user(p_org_id, auth.uid());
$$;

create or replace function public.redeem_organization_invite(p_invite_code text)
returns table(org_id uuid, org_name text, already_member boolean)
language sql
security invoker
set search_path = public, app_private
as $$
  select * from app_private.redeem_organization_invite_for_user(p_invite_code, auth.uid());
$$;

create or replace function public.get_org_members_for_user(p_org_id uuid, p_user_id uuid)
returns table(
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  role org_role,
  joined_at timestamptz
)
language sql
security definer
set search_path = public, app_private
as $$
  select * from app_private.get_org_members_for_user(p_org_id, p_user_id);
$$;

create or replace function public.redeem_organization_invite_for_user(p_invite_code text, p_user_id uuid)
returns table(org_id uuid, org_name text, already_member boolean)
language sql
security definer
set search_path = public, app_private
as $$
  select * from app_private.redeem_organization_invite_for_user(p_invite_code, p_user_id);
$$;

grant execute on function app_private.check_user_exists_by_email(text) to anon, authenticated, service_role;
grant execute on function app_private.get_invite_by_code(text) to anon, authenticated, service_role;
grant execute on function app_private.get_org_members_for_user(uuid, uuid) to anon, authenticated, service_role;
grant execute on function app_private.redeem_organization_invite_for_user(text, uuid) to anon, authenticated, service_role;

grant execute on function public.check_user_exists_by_email(text) to anon, authenticated, service_role;
grant execute on function public.get_invite_by_code(text) to anon, authenticated, service_role;
grant execute on function public.get_org_members(uuid) to authenticated, service_role;
grant execute on function public.redeem_organization_invite(text) to authenticated, service_role;

revoke execute on function public.get_org_members_for_user(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.redeem_organization_invite_for_user(text, uuid) from public, anon, authenticated;
grant execute on function public.get_org_members_for_user(uuid, uuid) to service_role;
grant execute on function public.redeem_organization_invite_for_user(text, uuid) to service_role;