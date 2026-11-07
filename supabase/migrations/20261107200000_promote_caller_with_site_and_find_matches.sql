-- Turning the caller of an Anfrage into a customer keeps what the call
-- captured and does not create a second record for a known customer.
--
-- 1. promote_client_request_caller created only the customer row: the
--    captured address landed in clients.address, so the conversion offered no
--    Einsatzort and the job readiness found none, and the caller's phone was
--    no Ansprechpartner. The same call now also creates the first work site
--    from the captured address and the primary contact from the caller's
--    name, phone and email, and links both to the request, so the conversion
--    starts with them. The signature and the return shape stay, so the
--    previous release calls it unchanged. It now runs as security invoker:
--    its caller, the service role, writes these tables without crossing RLS.
-- 2. find_client_request_caller_matches lists the organization's customers
--    whose phone, email or name, or a contact's, equals the caller's.
--    The server action promoteCallerToClient refuses an unconfirmed promotion
--    while it finds a match, and the request page shows the matches.
--
-- Division of work: the actions establish identity, the manager role and the
-- organization and pass it; the functions read and write only that
-- organization's rows.

-- A phone number reduced to the digits a person dials from Germany: spaces,
-- separators and the "(0)" trunk hint go, a leading + becomes 00 and the
-- German country code becomes the trunk 0. Fewer than six digits is no number
-- to compare and yields null.
create function app_private.normalized_phone(p_phone text)
returns text
language plpgsql
immutable
parallel safe
set search_path to ''
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '\(0\)', '', 'g');
  v_digits := regexp_replace(v_digits, '[^0-9+]', '', 'g');
  v_digits := regexp_replace(v_digits, '^\+', '00');
  v_digits := replace(v_digits, '+', '');
  v_digits := regexp_replace(v_digits, '^0049', '0');
  if length(v_digits) < 6 then
    return null;
  end if;
  return v_digits;
end;
$$;

revoke all on function app_private.normalized_phone(text) from public, anon, authenticated;
grant execute on function app_private.normalized_phone(text) to service_role;

-- Creates the customer from the captured caller fields, its first work site
-- from the captured address and its primary contact from the caller's name,
-- phone and email, links all three to the open request and records the
-- 'promoted' event, or refuses and changes nothing.
-- A request without an address gets no site.
-- Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_editable, already_matched, caller_name_required.
-- Returns the linked request.
create or replace function public.promote_client_request_caller(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_name text,
  p_client_type public.client_type
)
returns public.client_requests
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_name text;
  v_address text;
  v_address_parts text[];
  v_client_id uuid;
  v_contact_id uuid;
  v_site_id uuid;
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

  insert into public.client_contacts (
    organization_id, client_id, name, email, phone, is_primary, created_by
  ) values (
    p_organization_id, v_client_id,
    coalesce(nullif(btrim(v_request.caller_name), ''), v_name),
    nullif(btrim(v_request.caller_email), ''), nullif(btrim(v_request.caller_phone), ''),
    true, p_actor_id
  )
  returning id into v_contact_id;

  -- "Street 5, 12345 City" splits into its parts; any other text stays whole
  -- in the street, as adopting a customer address as a site does.
  v_address := nullif(btrim(v_request.caller_address), '');
  if v_address is not null then
    v_address_parts := regexp_match(v_address, '^(.+?)\s*,\s*(\d{5})\s+(.+)$');
    insert into public.client_sites (
      organization_id, client_id, name, street, postal_code, city, primary_contact_id,
      is_primary, created_by
    ) values (
      p_organization_id, v_client_id, 'Hauptstandort',
      coalesce(v_address_parts[1], v_address), v_address_parts[2], v_address_parts[3], v_contact_id,
      true, p_actor_id
    )
    returning id into v_site_id;
  end if;

  update public.client_requests request
  set client_id = v_client_id, site_id = v_site_id, contact_id = v_contact_id
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

-- The customers of the organization the caller of an open, unmatched request
-- may already be: equal normalized phone, equal email ignoring case, or an
-- equal name ignoring case and repeated spaces, on the customer or one of its
-- contacts. Each row names what matched; the strongest matches come first, at
-- most p_limit of them. A matched or finished request has no matches. Refuses
-- with request_not_found for a request outside the organization.
create function public.find_client_request_caller_matches(
  p_organization_id uuid,
  p_request_id uuid,
  p_limit integer
)
returns table (client_id uuid, client_name text, matched_on text[])
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_phone text;
  v_email text;
  v_name text;
begin
  select * into v_request from public.client_requests request
  where request.id = p_request_id and request.organization_id = p_organization_id;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.client_id is not null or v_request.status not in ('offen', 'in_klaerung') then
    return;
  end if;

  v_phone := app_private.normalized_phone(v_request.caller_phone);
  v_email := nullif(lower(btrim(v_request.caller_email)), '');
  v_name := nullif(lower(regexp_replace(btrim(v_request.caller_name), '\s+', ' ', 'g')), '');
  if v_phone is null and v_email is null and v_name is null then
    return;
  end if;

  return query
  with contact_hits as (
    select
      contact.client_id,
      bool_or(app_private.normalized_phone(contact.phone) = v_phone) as phone_hit,
      bool_or(lower(btrim(contact.email)) = v_email) as email_hit,
      bool_or(lower(regexp_replace(btrim(contact.name), '\s+', ' ', 'g')) = v_name) as name_hit
    from public.client_contacts contact
    where contact.organization_id = p_organization_id
      and (
        app_private.normalized_phone(contact.phone) = v_phone
        or lower(btrim(contact.email)) = v_email
        or lower(regexp_replace(btrim(contact.name), '\s+', ' ', 'g')) = v_name
      )
    group by contact.client_id
  ),
  hits as (
    select
      client.id,
      client.name,
      coalesce(app_private.normalized_phone(client.phone) = v_phone, false)
        or coalesce(contact_hits.phone_hit, false) as phone_hit,
      coalesce(lower(btrim(client.email)) = v_email, false)
        or coalesce(contact_hits.email_hit, false) as email_hit,
      coalesce(lower(regexp_replace(btrim(client.name), '\s+', ' ', 'g')) = v_name, false)
        or coalesce(contact_hits.name_hit, false) as name_hit
    from public.clients client
    left join contact_hits on contact_hits.client_id = client.id
    where client.organization_id = p_organization_id
  )
  select
    hits.id,
    hits.name,
    array_remove(array[
      case when hits.phone_hit then 'phone' end,
      case when hits.email_hit then 'email' end,
      case when hits.name_hit then 'name' end
    ], null)
  from hits
  where hits.phone_hit or hits.email_hit or hits.name_hit
  order by
    (hits.phone_hit::int + hits.email_hit::int + hits.name_hit::int) desc,
    hits.name,
    hits.id
  limit greatest(coalesce(p_limit, 0), 0);
end;
$$;

revoke all on function public.find_client_request_caller_matches(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.find_client_request_caller_matches(uuid, uuid, integer) to service_role;
