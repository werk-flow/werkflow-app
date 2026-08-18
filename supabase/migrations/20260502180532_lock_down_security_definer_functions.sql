create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

create or replace function app_private.get_user_org_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = p_user_id;
$$;

create or replace function app_private.get_user_admin_or_manager_org_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = p_user_id
    and role in ('admin', 'buero');
$$;

grant execute on function app_private.get_user_org_ids(uuid) to anon, authenticated, service_role;
grant execute on function app_private.get_user_admin_or_manager_org_ids(uuid) to anon, authenticated, service_role;

alter policy "Users can view clients in their orgs"
  on public.clients
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

alter policy "Users can view job assignments in their orgs"
  on public.job_assignments
  using (job_id in (
    select jobs.id
    from public.jobs
    where jobs.organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  ));

alter policy "Users can view jobs in their orgs"
  on public.jobs
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

alter policy "Admins and managers can view org invites"
  on public.organization_invites
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

alter policy "Users can view members of their orgs"
  on public.organization_members
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

alter policy "Members can view their organizations"
  on public.organizations
  using (id in (select app_private.get_user_org_ids((select auth.uid()))));

alter policy "Users can view projects in their orgs"
  on public.projects
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

alter policy "Users can view permitted time entries"
  on public.time_entries
  using (
    organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    and (
      user_id = (select auth.uid())
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id = time_entries.organization_id
          and om.user_id = (select auth.uid())
          and om.role = 'admin'::org_role
      )
      or exists (
        select 1
        from public.organization_members om_caller
        where om_caller.organization_id = time_entries.organization_id
          and om_caller.user_id = (select auth.uid())
          and om_caller.role = 'buero'::org_role
      )
    )
  );

create or replace function public.get_org_members_for_user(p_org_id uuid, p_user_id uuid)
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
  if not exists (
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

create or replace function public.redeem_organization_invite_for_user(p_invite_code text, p_user_id uuid)
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

revoke execute on function public.add_admin_membership() from public, anon, authenticated;
revoke execute on function public.check_user_exists_by_email(text) from public, anon, authenticated;
revoke execute on function public.generate_job_number(uuid) from public, anon, authenticated;
revoke execute on function public.generate_project_number(uuid) from public, anon, authenticated;
revoke execute on function public.get_invite_by_code(text) from public, anon, authenticated;
revoke execute on function public.get_org_clients(uuid) from public, anon, authenticated;
revoke execute on function public.get_org_members(uuid) from public, anon, authenticated;
revoke execute on function public.get_user_admin_or_manager_org_ids(uuid) from public, anon, authenticated;
revoke execute on function public.get_user_admin_org_ids(uuid) from public, anon, authenticated;
revoke execute on function public.get_user_org_ids(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_member_of_org(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.redeem_organization_invite(text) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.get_org_members_for_user(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.redeem_organization_invite_for_user(text, uuid) from public, anon, authenticated;

grant execute on function public.check_user_exists_by_email(text) to service_role;
grant execute on function public.generate_job_number(uuid) to service_role;
grant execute on function public.generate_project_number(uuid) to service_role;
grant execute on function public.get_invite_by_code(text) to service_role;
grant execute on function public.get_org_members_for_user(uuid, uuid) to service_role;
grant execute on function public.redeem_organization_invite_for_user(text, uuid) to service_role;