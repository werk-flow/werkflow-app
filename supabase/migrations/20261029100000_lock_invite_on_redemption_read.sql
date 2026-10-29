-- An invite cancelled during its redemption could still be redeemed.
--
-- redeem_organization_invite_for_user read the invite's status without a
-- lock, locked the row only later, and accepted the invite with an update
-- that did not filter by status. A cancel that committed between the read
-- and the update reported success, and the invitee still joined with the
-- invited role.
--
-- The first read now locks the invite row FOR UPDATE, so the status it reads
-- stays current until the redemption commits, and a cancel waits for it and
-- then finds the invite accepted (cancelInvite filters by 'pending'). The
-- later separate lock is gone. The final update accepts only a pending invite
-- and refuses with 'invite_already_used' otherwise, which rolls back the
-- membership and the personnel link.
--
-- The signature, the result, the refusals and the grants stay as before.

create or replace function app_private.redeem_organization_invite_for_user(p_invite_code text, p_user_id uuid)
returns table(org_id uuid, org_name text, already_member boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_invite_id uuid;
  v_linked_record_id uuid;
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

  select i.id,
         i.organization_id,
         o.admin_id,
         o.name,
         i.status,
         i.expires_at,
         i.email,
         i.invited_role
  into v_invite_id, v_org_id, v_admin_id, v_org_name, v_invite_status, v_expires_at, v_invite_email, v_invited_role
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.invite_code = p_invite_code
  for update of i;

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

  -- Link a personnel record that was waiting for this invite, unless the user
  -- already owns a record in this organization (e.g. rejoin after exit) -- in
  -- that case linking would violate the one-record-per-person constraint and
  -- the office resolves the duplicate manually.
  update public.employee_records er
     set user_id = v_user_id,
         invite_id = null,
         updated_at = v_now
   where er.organization_id = v_org_id
     and er.invite_id = v_invite_id
     and er.user_id is null
     and not exists (
       select 1 from public.employee_records er2
       where er2.organization_id = v_org_id and er2.user_id = v_user_id
     )
  returning er.id into v_linked_record_id;

  if v_linked_record_id is not null then
    insert into public.employee_record_events (organization_id, employee_record_id, event_type, event_payload, created_by)
    values (v_org_id, v_linked_record_id, 'login_linked', jsonb_build_object('invite_id', v_invite_id), v_user_id);
  end if;

  insert into public.organization_members (user_id, organization_id, role)
  values (v_user_id, v_org_id, coalesce(v_invited_role, 'employee'));

  update public.organization_invites
    set status = 'accepted', accepted_at = v_now
  where id = v_invite_id
    and status = 'pending';

  if not found then
    raise exception 'invite_already_used';
  end if;

  return query select v_org_id, v_org_name, v_already_member;
end;
$function$;