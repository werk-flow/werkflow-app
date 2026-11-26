-- What the header search reads through the customer and request list readers
-- (docs/features/customers-and-crm.md, "Search"): a phone number typed in any
-- spelling finds a customer, an active contact and a request caller by its
-- digits; a contact also matches by name and email and finds its customer.
-- Einsatzorte and Ansprechpartner are matched and limited on their own, so one
-- under a customer beyond the first page of matching customers is found. A
-- matching record of another organization is never returned.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('48700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'search-owner@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now());

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('48700000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '48700000-0000-4000-8000-000000000001', 'SEARCH01'),
('48700000-0000-4000-8000-000000000011', 'Fremde Haustechnik GmbH',
 '48700000-0000-4000-8000-000000000001', 'SEARCH02');

insert into public.clients (id, organization_id, name, phone) values
('48700000-0000-4000-8000-000000000020', '48700000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', '+49 711 12345'),
('48700000-0000-4000-8000-000000000021', '48700000-0000-4000-8000-000000000010',
 'Erika Musterfrau', null),
('48700000-0000-4000-8000-000000000022', '48700000-0000-4000-8000-000000000010',
 'Musterweg Bau', '030 999 88'),
('48700000-0000-4000-8000-000000000029', '48700000-0000-4000-8000-000000000011',
 'Fremder Kunde', '0711 12345');

-- Six customers named „Müller“ fill the first page of five; a seventh holds
-- a contact „Müller“ and an Objekt in the Müllerstraße; two of the six hold
-- one more such contact and Objekt. An archived customer holds the same.
insert into public.clients (id, organization_id, name, archived_at)
select ('48700000-0000-4000-8000-00000000005' || n)::uuid, '48700000-0000-4000-8000-000000000010',
  'Müller Haustechnik ' || n, null
from generate_series(1, 6) n;
insert into public.clients (id, organization_id, name, archived_at) values
('48700000-0000-4000-8000-000000000057', '48700000-0000-4000-8000-000000000010',
 'Sonnenberg Wohnbau GmbH', null),
('48700000-0000-4000-8000-000000000058', '48700000-0000-4000-8000-000000000010',
 'Archivierte Verwaltung', now());
insert into public.client_contacts (id, organization_id, client_id, name, is_active) values
('48700000-0000-4000-8000-000000000060', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000057', 'Erika Müller', true),
('48700000-0000-4000-8000-000000000061', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000058', 'Max Müller', true),
('48700000-0000-4000-8000-000000000062', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000051', 'Paul Müller', true),
('48700000-0000-4000-8000-000000000069', '48700000-0000-4000-8000-000000000011',
 '48700000-0000-4000-8000-000000000029', 'Fremde Müller', true);
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city, is_active) values
('48700000-0000-4000-8000-000000000070', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000057', 'Wohnanlage Sonnenberg', 'Müllerstraße 3', '70173', 'Stuttgart', true),
('48700000-0000-4000-8000-000000000071', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000058', 'Altbau', 'Müllerstraße 5', '70173', 'Stuttgart', true),
('48700000-0000-4000-8000-000000000072', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000057', 'Abgegebenes Objekt', 'Müllerstraße 7', '70173', 'Stuttgart', false),
('48700000-0000-4000-8000-000000000073', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000052', 'Müller Haus', 'Am Markt 1', '70173', 'Stuttgart', true),
('48700000-0000-4000-8000-000000000079', '48700000-0000-4000-8000-000000000011',
 '48700000-0000-4000-8000-000000000029', 'Fremdes Objekt', 'Müllerstraße 3', '70173', 'Stuttgart', true);

insert into public.client_contacts (id, organization_id, client_id, name, email, phone, is_active) values
('48700000-0000-4000-8000-000000000030', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000021', 'Max Mustermann', 'max.mustermann@example.test',
 '0049 30 4440 777', true),
('48700000-0000-4000-8000-000000000031', '48700000-0000-4000-8000-000000000010',
 '48700000-0000-4000-8000-000000000021', 'Alter Kontakt', 'alt@example.test', '030 4440777', false),
('48700000-0000-4000-8000-000000000039', '48700000-0000-4000-8000-000000000011',
 '48700000-0000-4000-8000-000000000029', 'Fremder Kontakt', 'max.mustermann@example.test',
 '030 4440777', true);

insert into public.client_requests (id, organization_id, summary, caller_name, caller_phone, status) values
('48700000-0000-4000-8000-000000000040', '48700000-0000-4000-8000-000000000010',
 'Heizung kalt', 'Erika Musterfrau', '0711-123 45', 'in_klaerung'),
('48700000-0000-4000-8000-000000000049', '48700000-0000-4000-8000-000000000011',
 'Fremde Anfrage', 'Erika Musterfrau', '0711 12345', 'offen');

-- The search counts as a number only when it holds nothing but digits and
-- separators; both sides compare by their normalized digits.
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    array['071112345', '0711 / 123 45', 'true'],
    array['+49 711 12345', '0711 / 123 45', 'true'],
    array['0711 12345', '+49 711 123', 'true'],
    array['0711 12345', '711 12345', 'true'],
    array['0711 12345', '(0711) 123-45', 'true'],
    array['0711-12345', E'+49\u00a0711\u00a012345', 'true'],
    array['0711-12345', E'0711\u202f123\u200945', 'true'],
    array['0711-12345', E'0711\t12345', 'true'],
    array['0711 12345', '0711 54321', 'false'],
    array['0711 12345', 'Musterweg 12345', 'false'],
    array['0711 12345', '12345', 'false'],
    array['0711 12345', '', 'false'],
    array[null, '0711 12345', 'false']
  ] loop
    if app_private.phone_matches_search(v_case[1], v_case[2]) is distinct from v_case[3]::boolean then
      raise exception 'phone % against search % matched %, expected %',
        v_case[1], v_case[2], app_private.phone_matches_search(v_case[1], v_case[2]), v_case[3];
    end if;
  end loop;
  if app_private.phone_matches_search('0711 12345', null) then
    raise exception 'a missing search matched a phone';
  end if;
end;
$$;

do $$
declare
  v_org uuid := '48700000-0000-4000-8000-000000000010';
  v_result jsonb;
  v_ids text[];
  v_signature text;
begin
  foreach v_signature in array array[
    'app_private.phone_matches_search(text,text)',
    'app_private.customer_search_sites(uuid,text)',
    'app_private.customer_search_contacts(uuid,text)',
    'public.search_customer_sites_and_contacts(uuid,text,integer)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'search helper grant mismatch: %', v_signature;
    end if;
  end loop;

  -- A customer by the digits of its phone; the foreign customer with the same number stays out.
  v_result := public.list_customer_page(v_org, '0711 / 123 45', 1, 5, false);
  select array_agg(client->>'id') into v_ids from jsonb_array_elements(v_result->'clients') client;
  if v_ids is distinct from array['48700000-0000-4000-8000-000000000020']
    or (v_result->>'total')::integer is distinct from 1 then
    raise exception 'customer phone digits found %', v_result;
  end if;

  -- A contact by the digits of its phone finds its customer and the contact itself.
  v_result := public.list_customer_page(v_org, '+49 30 4440777', 1, 5, false);
  if jsonb_array_length(v_result->'clients') is distinct from 1
    or v_result->'clients'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000021' then
    raise exception 'contact phone digits found the customers %', v_result;
  end if;
  v_result := public.search_customer_sites_and_contacts(v_org, '+49 30 4440777', 5);
  if jsonb_array_length(v_result->'contacts') is distinct from 1
    or v_result->'contacts'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000030'
    or v_result->'contacts'->0->>'clientId' is distinct from '48700000-0000-4000-8000-000000000021'
    or v_result->'contacts'->0->>'clientName' is distinct from 'Erika Musterfrau' then
    raise exception 'contact phone digits found the contacts %', v_result;
  end if;

  -- A contact by email; the inactive contact and the foreign contact stay out.
  v_result := public.list_customer_page(v_org, 'max.mustermann@example', 1, 5, false);
  if jsonb_array_length(v_result->'clients') is distinct from 1 then
    raise exception 'contact email found the customers %', v_result;
  end if;
  v_result := public.search_customer_sites_and_contacts(v_org, 'max.mustermann@example', 5);
  if jsonb_array_length(v_result->'contacts') is distinct from 1
    or v_result->'contacts'->0->>'email' is distinct from 'max.mustermann@example.test' then
    raise exception 'contact email found the contacts %', v_result;
  end if;

  -- Six customers „Müller“ fill the customer page; the contact and the Objekt
  -- under the seventh are still found, never those of an archived customer,
  -- an inactive Objekt or another organization.
  v_result := public.list_customer_page(v_org, 'Müller', 1, 5, false);
  if (v_result->>'total')::integer is distinct from 7
    or v_result->'clients' @> '[{"id": "48700000-0000-4000-8000-000000000057"}]'::jsonb then
    raise exception 'the seventh customer is on the first page: %', v_result;
  end if;
  v_result := public.search_customer_sites_and_contacts(v_org, 'Müller', 5);
  select array_agg(row->>'id') into v_ids from jsonb_array_elements(v_result->'contacts') row;
  if v_ids is distinct from array['48700000-0000-4000-8000-000000000060', '48700000-0000-4000-8000-000000000062'] then
    raise exception 'contacts under any matching customer found %', v_result;
  end if;
  select array_agg(row->>'id') into v_ids from jsonb_array_elements(v_result->'sites') row;
  if v_ids is distinct from array['48700000-0000-4000-8000-000000000073', '48700000-0000-4000-8000-000000000070']
    or v_result->'sites'->1->>'clientName' is distinct from 'Sonnenberg Wohnbau GmbH'
    or v_result->'sites'->1->>'street' is distinct from 'Müllerstraße 3' then
    raise exception 'Objekte under any matching customer found %', v_result;
  end if;
  -- Each kind is limited on its own.
  v_result := public.search_customer_sites_and_contacts(v_org, 'Müller', 1);
  if v_result->'contacts' is distinct from jsonb_build_array(v_result->'contacts'->0)
    or v_result->'contacts'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000060'
    or v_result->'sites' is distinct from jsonb_build_array(v_result->'sites'->0)
    or v_result->'sites'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000073' then
    raise exception 'the limit held not per kind: %', v_result;
  end if;

  -- A street with a house number never matches by digits.
  v_result := public.list_customer_page(v_org, 'Musterweg 12345', 1, 5, false);
  if (v_result->>'total')::integer is distinct from 0 then
    raise exception 'a street matched a phone: %', v_result;
  end if;

  -- A search without a contact or Objekt match lists none.
  v_result := public.search_customer_sites_and_contacts(v_org, 'Lindenhof', 5);
  if v_result is distinct from '{"sites": [], "contacts": []}'::jsonb then
    raise exception 'a customer match listed contacts or Objekte: %', v_result;
  end if;

  -- A request by the digits of the caller's phone; never the foreign one.
  v_result := public.list_request_page(v_org, 'alle', '+49 711 12345', '{}', 1, 5);
  select array_agg(row->>'id') into v_ids from jsonb_array_elements(v_result->'rows') row;
  if v_ids is distinct from array['48700000-0000-4000-8000-000000000040']
    or (v_result->>'total')::integer is distinct from 1 then
    raise exception 'request caller phone digits found %', v_result;
  end if;
end;
$$;

rollback;
