-- Promoting the caller of an Anfrage to a customer is all or nothing. The
-- server action promoteCallerToClient in lib/requests/actions.ts inserted the
-- customer, linked it to the request in a second statement and, when the link
-- failed, deleted the customer again without checking the delete; the
-- 'promoted' history row was a third, best-effort statement. A failure
-- between the steps left an unlinked duplicate customer or a link without
-- its history row. The three writes are now one function call.
--
-- Division of work: the action establishes identity, the active membership,
-- the manager role and the request's organization, and passes the name the
-- caller typed. The function locks the request and the actor's membership,
-- re-checks the state under those locks and raises the action failure code
-- of the first refusal, so nothing changes.
--
-- Signals stay as before: the request UPDATE reaches the Realtime
-- publication of client_requests, and the customer INSERT is a new row of
-- clients that the action's caller refreshes.

-- Creates the customer from the captured caller fields, links it to the open
-- request and records the 'promoted' event, or refuses and changes nothing.
-- Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_editable, already_matched, caller_name_required.
-- Returns the linked request.
create function public.promote_client_request_caller(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_name text,
  p_client_type public.client_type
)
returns public.client_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_name text;
  v_client_id uuid;
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_request from public.client_requests request
  where request.id = p_request_id and request.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'request_not_found';
  end if;

  -- A share lock holds the actor's membership until commit: a removal or a
  -- role change waits for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role in ('admin', 'buero')
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;

  if v_request.status not in ('offen', 'in_klaerung') then
    raise exception 'request_not_editable';
  end if;
  if v_request.client_id is not null then
    raise exception 'already_matched';
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), nullif(btrim(v_request.caller_name), ''));
  if v_name is null then
    raise exception 'caller_name_required';
  end if;

  insert into public.clients (organization_id, name, client_type, email, phone, address)
  values (
    p_organization_id, v_name, coalesce(p_client_type, 'privat'),
    v_request.caller_email, v_request.caller_phone, v_request.caller_address
  )
  returning id into v_client_id;

  update public.client_requests request
  set client_id = v_client_id
  where request.id = p_request_id and request.organization_id = p_organization_id
  returning * into v_request;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'promoted',
    jsonb_build_object('clientId', v_client_id, 'clientName', v_name), p_actor_id
  );

  return v_request;
end;
$$;

revoke all on function public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type)
  from public, anon, authenticated;
grant execute on function public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type)
  to service_role;
