-- Creating a customer shows the organization's likely duplicates with their
-- reasons before it saves (werk-flow/werkflow-planning#323).
--
-- 1. find_client_duplicates is the one matcher of a draft customer against
--    the organization's customers: same customer number, phone in any
--    notation, email in any case, same name and postal code, same street and
--    postal code. Phone and name compare the customer and its contacts; the
--    postal code and the street compare the main address and the sites.
--    Archived contacts and sites count: a duplicate stays a duplicate.
-- 2. find_client_request_caller_matches keeps its signature and return shape
--    and now asks find_client_duplicates with the captured caller, so the
--    request promotion lists the same reasons. A name alone no longer
--    matches; it needs the postal code as well.
--
-- Division of work: the server actions establish identity, the manager role
-- and the organization and pass it; the functions read only that
-- organization's rows and write nothing.

-- A name compared ignoring case and repeated spaces; blank is no name.
create function app_private.normalized_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')), '');
$$;

-- An email compared ignoring case and surrounding spaces; blank is no email.
create function app_private.normalized_email(p_email text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

-- The first German postal code, five digits standing alone, in a text.
create function app_private.postal_code(p_text text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select (regexp_match(coalesce(p_text, ''), '(?:^|[^0-9])([0-9]{5})(?:[^0-9]|$)'))[1];
$$;

-- A street compared ignoring case, spacing, punctuation and the spellings
-- "Straße", "Strasse" and "Str.". Blank is no street.
create function app_private.street_key(p_street text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(p_street, '')), 'stra(ß|ss)e|str\.', 'str', 'g'),
      '[[:space:].,;:/''-]+', '', 'g'
    ),
    ''
  );
$$;

-- The street of a free-form address: the text before its postal code and a
-- country prefix of it ("D-", "DE-"), as in "Lindenstraße 5, D-12345
-- Musterstadt"; street_key drops the separator. An address without a postal
-- code has no street.
create function app_private.address_street(p_address text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select (regexp_match(
    coalesce(p_address, ''),
    '^(.*?)(?:(?:^|[^0-9A-Za-z])(?:[Dd][Ee]?)-|^|[^0-9])[0-9]{5}(?:[^0-9]|$)'
  ))[1];
$$;

revoke all on function app_private.normalized_name(text) from public, anon, authenticated;
revoke all on function app_private.normalized_email(text) from public, anon, authenticated;
revoke all on function app_private.postal_code(text) from public, anon, authenticated;
revoke all on function app_private.street_key(text) from public, anon, authenticated;
revoke all on function app_private.address_street(text) from public, anon, authenticated;
grant execute on function app_private.normalized_name(text) to service_role;
grant execute on function app_private.normalized_email(text) to service_role;
grant execute on function app_private.postal_code(text) to service_role;
grant execute on function app_private.street_key(text) to service_role;
grant execute on function app_private.address_street(text) to service_role;

-- The customers of the organization a draft customer may already be. Each row
-- names its reasons in this order: customer_number, phone, email, name (the
-- name and the postal code), address (the street and the postal code). The
-- most reasons come first, at most p_limit rows. A draft without anything to
-- compare has no matches.
create function public.find_client_duplicates(
  p_organization_id uuid,
  p_customer_number text,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_limit integer
)
returns table (client_id uuid, client_name text, matched_on text[])
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_number text := nullif(lower(btrim(coalesce(p_customer_number, ''))), '');
  v_name text := app_private.normalized_name(p_name);
  v_phone text := app_private.normalized_phone(p_phone);
  v_email text := app_private.normalized_email(p_email);
  v_postal text := app_private.postal_code(p_address);
  v_street text := app_private.street_key(app_private.address_street(p_address));
begin
  if p_organization_id is null then
    raise exception 'invalid_input';
  end if;
  if v_number is null and v_phone is null and v_email is null
    and (v_name is null or v_postal is null) and (v_street is null or v_postal is null)
  then
    return;
  end if;

  return query
  with contact_hits as (
    select
      contact.client_id,
      bool_or(app_private.normalized_phone(contact.phone) = v_phone) as phone_hit,
      bool_or(app_private.normalized_email(contact.email) = v_email) as email_hit,
      bool_or(app_private.normalized_name(contact.name) = v_name) as name_hit
    from public.client_contacts contact
    where contact.organization_id = p_organization_id
      and (
        app_private.normalized_phone(contact.phone) = v_phone
        or app_private.normalized_email(contact.email) = v_email
        or app_private.normalized_name(contact.name) = v_name
      )
    group by contact.client_id
  ),
  site_hits as (
    select
      site.client_id,
      bool_or(app_private.street_key(site.street) = v_street) as street_hit
    from public.client_sites site
    where site.organization_id = p_organization_id
      and app_private.postal_code(site.postal_code) = v_postal
    group by site.client_id
  ),
  hits as (
    select
      client.id,
      client.name,
      coalesce(lower(btrim(client.customer_number)) = v_number, false) as number_hit,
      coalesce(app_private.normalized_phone(client.phone) = v_phone, false)
        or coalesce(contact_hits.phone_hit, false) as phone_hit,
      coalesce(app_private.normalized_email(client.email) = v_email, false)
        or coalesce(contact_hits.email_hit, false) as email_hit,
      (
        coalesce(app_private.normalized_name(client.name) = v_name, false)
        or coalesce(contact_hits.name_hit, false)
      ) and (
        coalesce(app_private.postal_code(client.address) = v_postal, false)
        or site_hits.client_id is not null
      ) as name_hit,
      coalesce(
        app_private.postal_code(client.address) = v_postal
          and app_private.street_key(app_private.address_street(client.address)) = v_street,
        false
      ) or coalesce(site_hits.street_hit, false) as address_hit
    from public.clients client
    left join contact_hits on contact_hits.client_id = client.id
    left join site_hits on site_hits.client_id = client.id
    where client.organization_id = p_organization_id
  )
  select
    hits.id,
    hits.name,
    array_remove(array[
      case when hits.number_hit then 'customer_number' end,
      case when hits.phone_hit then 'phone' end,
      case when hits.email_hit then 'email' end,
      case when hits.name_hit then 'name' end,
      case when hits.address_hit then 'address' end
    ], null)
  from hits
  where hits.number_hit or hits.phone_hit or hits.email_hit or hits.name_hit or hits.address_hit
  order by
    (hits.number_hit::int + hits.phone_hit::int + hits.email_hit::int
      + hits.name_hit::int + hits.address_hit::int) desc,
    hits.name,
    hits.id
  limit greatest(coalesce(p_limit, 0), 0);
end;
$$;

revoke all on function public.find_client_duplicates(uuid, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.find_client_duplicates(uuid, text, text, text, text, text, integer)
  to service_role;

-- The customers of the organization the caller of an open, unmatched request
-- may already be, by find_client_duplicates on the captured caller. A matched
-- or finished request has no matches. Refuses with request_not_found for a
-- request outside the organization.
create or replace function public.find_client_request_caller_matches(
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
begin
  select * into v_request from public.client_requests request
  where request.id = p_request_id and request.organization_id = p_organization_id;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.client_id is not null or v_request.status not in ('offen', 'in_klaerung') then
    return;
  end if;

  return query
  select duplicate.client_id, duplicate.client_name, duplicate.matched_on
  from public.find_client_duplicates(
    p_organization_id, null, v_request.caller_name, v_request.caller_phone,
    v_request.caller_email, v_request.caller_address, p_limit
  ) duplicate;
end;
$$;
