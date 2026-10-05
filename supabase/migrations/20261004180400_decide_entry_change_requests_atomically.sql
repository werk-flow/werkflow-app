-- Deciding a change request of a time entry records the decision and applies
-- it to the entries together or not at all. The server action
-- reviewChangeRequest in lib/time-tracking/actions.ts wrote the request status
-- first, applied the decision to the entries in a second statement and, when
-- that failed, wrote the request back to pending in a third, compensating
-- statement whose own failure left a decided request with unchanged entries.
--
-- Division of work: the action establishes identity, the request's
-- organization and the caller's admin membership in it, and answers a closed
-- period early. The function locks the request and the actor's membership,
-- repeats the membership, role and state checks under those locks and raises
-- the action failure code of the first refusal, so nothing changes. The
-- closed-period trigger (20261002110000) refuses a write to a day of a closed
-- period with SQLSTATE WFP01 and aborts the whole call in the same way.
--
-- Decision semantics stay as before (the immediate-effect model): approving
-- an edit writes no entry, because the edit was applied when it was requested;
-- approving a delete removes the entry and its paired entry, and the foreign
-- key cascade removes the request with them; rejecting an edit restores the
-- original timestamp; rejecting a delete restores both entries to 'approved'.
--
-- Signals stay as before: the request UPDATE and the entry UPDATEs reach the
-- Realtime publication, and a DELETE writes its realtime_deletions notice
-- through the emit_realtime_deletion triggers.

-- Records the decision and applies it, or refuses and changes nothing.
-- Refusals: invalid_input, request_not_found, not_a_member, not_authorized,
-- request_already_reviewed; a closed period raises WFP01 'period_closed'.
-- Returns the decided request as it was recorded.
create function public.decide_entry_change_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_decision text
)
returns public.entry_change_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.entry_change_requests;
  v_role public.org_role;
  v_entry_ids uuid[];
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null
    or p_decision is null or p_decision not in ('approve', 'reject')
  then
    raise exception 'invalid_input';
  end if;

  select * into v_request from public.entry_change_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  if not found then raise exception 'request_not_found'; end if;

  -- The actor stays an admin until commit: a removal or a role change waits
  -- for this call or makes it refuse.
  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if not found then raise exception 'not_a_member'; end if;
  if v_role <> 'admin' then raise exception 'not_authorized'; end if;

  if v_request.status <> 'pending' then raise exception 'request_already_reviewed'; end if;

  update public.entry_change_requests request
  set status = case p_decision when 'approve' then 'approved' else 'rejected' end::public.change_request_status,
      reviewed_by = p_actor_id,
      reviewed_at = now()
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  v_entry_ids := array[v_request.entry_id, coalesce(v_request.paired_entry_id, v_request.entry_id)];

  if p_decision = 'approve' then
    if v_request.change_type = 'delete' then
      -- One statement deletes the pair, so a refused delete (an entry a work
      -- artifact or correction still references) never leaves half of it.
      delete from public.time_entries entry
      where entry.organization_id = p_organization_id and entry.id = any(v_entry_ids);
    end if;
  elsif v_request.change_type = 'edit' then
    if v_request.original_timestamp is not null then
      update public.time_entries entry
      set timestamp = v_request.original_timestamp
      where entry.organization_id = p_organization_id and entry.id = v_request.entry_id;
    end if;
  elsif v_request.change_type = 'delete' then
    update public.time_entries entry
    set status = 'approved'
    where entry.organization_id = p_organization_id and entry.id = any(v_entry_ids);
  end if;

  return v_request;
end;
$$;

revoke all on function public.decide_entry_change_request(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decide_entry_change_request(uuid, uuid, uuid, text) to service_role;
