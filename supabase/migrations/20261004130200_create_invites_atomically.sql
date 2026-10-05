-- Creating an organization invite, with its personnel record connection, is
-- one transaction, and an invite whose mail failed is withdrawn in one.
--
-- sendPersonnelInvite (lib/personnel/actions.ts) cancelled the record's
-- pending invite, inserted the new invite and mailed it, and only then
-- connected it to the record in a separate statement. A refused connection
-- left a mailed invite that redemption would turn into a second person, and
-- the earlier invite cancelled. sendOrgInvite (lib/invites/actions.ts)
-- deleted the invite after a failed mail without checking that delete.
--
-- Order (owner brief 2026-10-04): every write before the mail, so a failed
-- write never sends a mail; a failed mail withdraws exactly what this send
-- wrote, so nothing stays behind that nobody received. The mail itself is
-- outside the database and therefore between the two functions.
--
-- The actions establish identity, the active membership and the manager role,
-- check the address against existing members and the rate limit, and draw
-- the invite code. These functions repeat the state checks under their locks.

-- Inserts a pending invite and, when a personnel record is named, cancels the
-- record's earlier pending invite and connects the new one.
-- Refusals: invalid_role, record_not_found, already_has_login,
-- invite_already_pending. Returns the new invite and the invite it replaced.
create function public.create_organization_invite(
  p_organization_id uuid,
  p_email text,
  p_invite_code text,
  p_invited_role public.org_role,
  p_employee_record_id uuid
)
returns table (invite_id uuid, replaced_invite_id uuid)
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_record_user_id uuid;
  v_record_invite_id uuid;
  v_replaced_invite_id uuid;
  v_invite_id uuid;
  v_constraint text;
begin
  if p_invited_role is null or p_invited_role not in ('buero', 'employee') then
    raise exception 'invalid_role';
  end if;

  if p_employee_record_id is not null then
    select employee.user_id, employee.invite_id
    into v_record_user_id, v_record_invite_id
    from public.employee_records employee
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
    for update;
    if not found then raise exception 'record_not_found'; end if;
    if v_record_user_id is not null then raise exception 'already_has_login'; end if;

    -- A replaced invite that stayed pending would remain redeemable and
    -- create a second person; redeemed and expired invites stay untouched.
    if v_record_invite_id is not null then
      update public.organization_invites invite
      set status = 'cancelled'
      where invite.id = v_record_invite_id
        and invite.organization_id = p_organization_id
        and invite.status = 'pending'
      returning invite.id into v_replaced_invite_id;
    end if;
  end if;

  if exists (
    select 1 from public.organization_invites invite
    where invite.organization_id = p_organization_id
      and invite.email = p_email
      and invite.status = 'pending'
  ) then raise exception 'invite_already_pending'; end if;

  begin
    insert into public.organization_invites (organization_id, email, invite_code, invited_role)
    values (p_organization_id, p_email, p_invite_code, p_invited_role)
    returning id into v_invite_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organization_invites_unique_pending_email' then
      raise exception 'invite_already_pending';
    end if;
    raise;
  end;

  if p_employee_record_id is not null then
    update public.employee_records employee
    set invite_id = v_invite_id
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id;
  end if;

  return query select v_invite_id, v_replaced_invite_id;
end;
$$;

-- Withdraws an invite whose mail could not be sent: deletes it while it is
-- still pending (the record's invite_id clears through its foreign key) and
-- gives the record back the invite this send replaced, when that one is still
-- cancelled, unexpired and its address has no other pending invite.
-- Returns whether the unsent invite was deleted.
create function public.discard_unsent_organization_invite(
  p_organization_id uuid,
  p_invite_id uuid,
  p_replaced_invite_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_record_id uuid;
  v_deleted boolean;
begin
  select employee.id into v_record_id
  from public.employee_records employee
  where employee.organization_id = p_organization_id and employee.invite_id = p_invite_id
  for update;

  delete from public.organization_invites invite
  where invite.id = p_invite_id
    and invite.organization_id = p_organization_id
    and invite.status = 'pending';
  v_deleted := found;

  if v_deleted and v_record_id is not null and p_replaced_invite_id is not null then
    update public.organization_invites invite
    set status = 'pending'
    where invite.id = p_replaced_invite_id
      and invite.organization_id = p_organization_id
      and invite.status = 'cancelled'
      and invite.expires_at > now()
      and not exists (
        select 1 from public.organization_invites other
        where other.organization_id = p_organization_id
          and other.email = invite.email
          and other.status = 'pending'
      );
    if found then
      update public.employee_records employee
      set invite_id = p_replaced_invite_id
      where employee.id = v_record_id
        and employee.organization_id = p_organization_id
        and employee.invite_id is null;
    end if;
  end if;

  return v_deleted;
end;
$$;

revoke all on function public.create_organization_invite(uuid, text, text, public.org_role, uuid)
  from public, anon, authenticated;
revoke all on function public.discard_unsent_organization_invite(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_organization_invite(uuid, text, text, public.org_role, uuid)
  to service_role;
grant execute on function public.discard_unsent_organization_invite(uuid, uuid, uuid) to service_role;
