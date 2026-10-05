-- Reviewing or deleting a selection of time entries is all or nothing (owner
-- decision 2026-10-03). The server actions reviewEntries and
-- deleteEntriesBatch in lib/time-tracking/actions.ts wrote in id batches of
-- 100, so a refusal in a later batch left the earlier batches applied. Each
-- operation is now one function call, and so one transaction.
--
-- Division of work: the action establishes identity, the active membership,
-- the organization of the entries and the caller's right over each person
-- (the time_approval responsibility for a review, canManageEntries for a
-- deletion), and passes the people it authorized. The function locks the
-- entries and the memberships, re-checks the state under those locks and
-- raises the action failure code of the first refusal, so nothing changes.
-- The closed-period trigger (20261002110000) refuses a day of a closed period
-- with SQLSTATE WFP01 and aborts the whole call in the same way.
--
-- Signals stay as before: an UPDATE of time_entries reaches the Realtime
-- publication, and a DELETE writes its realtime_deletions notice through the
-- emit_realtime_deletion trigger.

-- The first step of both functions: a list of distinct ids, every entry in the
-- organization and locked, the actor and every entry's person still members.
-- It runs as the calling function's owner and no role executes it directly.
create function app_private.lock_time_entry_batch(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_entry_count integer := coalesce(cardinality(p_entry_ids), 0);
  v_locked_count integer;
begin
  if v_entry_count = 0
    or v_entry_count <> (select count(distinct entry_id) from unnest(p_entry_ids) entry_id)
  then
    raise exception 'invalid_input';
  end if;

  select count(*) into v_locked_count
  from (
    select entry.id from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
    order by entry.id
    for update
  ) locked;
  if v_locked_count <> v_entry_count then
    raise exception 'entry_not_found';
  end if;

  -- A share lock holds the actor's and every target's membership until commit:
  -- a removal or role change waits for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and (member.user_id = p_actor_id or member.user_id in (
      select entry.user_id from public.time_entries entry
      where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
    ))
  order by member.user_id
  for share;

  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ) then
    raise exception 'not_a_member';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and not exists (
        select 1 from public.organization_members member
        where member.organization_id = p_organization_id and member.user_id = entry.user_id
      )
  ) then
    raise exception 'target_not_found';
  end if;
end;
$$;

-- Approves or rejects every named entry, or refuses and changes nothing.
-- Refusals: invalid_input, entry_not_found, not_a_member, target_not_found,
-- entry_not_pending, self_approval_not_allowed, not_responsible; a closed
-- period raises WFP01 'period_closed'. Returns the number of reviewed entries.
create function public.review_time_entries(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_ids uuid[],
  p_decision text,
  p_authorized_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_reviewed integer;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_time_entry_batch(p_actor_id, p_organization_id, p_entry_ids);
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.status <> 'pending'
  ) then
    raise exception 'entry_not_pending';
  end if;
  -- Nobody reviews their own time, whatever the action passed.
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id = p_actor_id
  ) then
    raise exception 'self_approval_not_allowed';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id <> all (coalesce(p_authorized_user_ids, '{}'))
  ) then
    raise exception 'not_responsible';
  end if;

  update public.time_entries entry
  set status = p_decision::public.time_entry_status, reviewed_by = p_actor_id, reviewed_at = now()
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids);
  get diagnostics v_reviewed = row_count;
  return v_reviewed;
end;
$$;

-- Deletes every named entry, or refuses and changes nothing.
-- Refusals: invalid_input, entry_not_found, not_a_member, target_not_found,
-- not_authorized; a closed period raises WFP01 'period_closed'. Returns the
-- number of deleted entries.
create function public.delete_time_entries(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_ids uuid[],
  p_authorized_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted integer;
begin
  perform app_private.lock_time_entry_batch(p_actor_id, p_organization_id, p_entry_ids);
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id <> all (coalesce(p_authorized_user_ids, '{}'))
  ) then
    raise exception 'not_authorized';
  end if;
  delete from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function app_private.lock_time_entry_batch(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.review_time_entries(uuid, uuid, uuid[], text, uuid[])
  from public, anon, authenticated;
revoke all on function public.delete_time_entries(uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.review_time_entries(uuid, uuid, uuid[], text, uuid[]) to service_role;
grant execute on function public.delete_time_entries(uuid, uuid, uuid[], uuid[]) to service_role;
