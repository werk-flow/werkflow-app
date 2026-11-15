-- What the header search reads through the customer and request list readers
-- (docs/features/customers-and-crm.md, "Search"): a phone number typed in any
-- spelling finds a customer, an active contact and a request caller by its
-- digits; a contact also matches by name and email and comes back with its
-- customer; a matching record of another organization is never returned.
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
  foreach v_signature in array array['app_private.phone_matches_search(text,text)'] loop
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

  -- A contact by the digits of its phone: its customer comes back with the contact.
  v_result := public.list_customer_page(v_org, '+49 30 4440777', 1, 5, false);
  if jsonb_array_length(v_result->'clients') is distinct from 1
    or v_result->'clients'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000021'
    or (v_result->'clients'->0->>'matchedContactTotal')::integer is distinct from 1
    or v_result->'clients'->0->'matchedContacts'->0->>'id' is distinct from '48700000-0000-4000-8000-000000000030'
    or v_result->'clients'->0->'matchedContacts'->0->>'name' is distinct from 'Max Mustermann' then
    raise exception 'contact phone digits found %', v_result;
  end if;

  -- A contact by email; the inactive contact and the foreign contact stay out.
  v_result := public.list_customer_page(v_org, 'max.mustermann@example', 1, 5, false);
  if jsonb_array_length(v_result->'clients') is distinct from 1
    or jsonb_array_length(v_result->'clients'->0->'matchedContacts') is distinct from 1
    or v_result->'clients'->0->'matchedContacts'->0->>'email' is distinct from 'max.mustermann@example.test' then
    raise exception 'contact email found %', v_result;
  end if;

  -- A street with a house number never matches by digits.
  v_result := public.list_customer_page(v_org, 'Musterweg 12345', 1, 5, false);
  if (v_result->>'total')::integer is distinct from 0 then
    raise exception 'a street matched a phone: %', v_result;
  end if;

  -- A search without a contact match lists no contacts.
  v_result := public.list_customer_page(v_org, 'Lindenhof', 1, 5, false);
  if v_result->'clients'->0->'matchedContacts' is distinct from '[]'::jsonb
    or (v_result->'clients'->0->>'matchedContactTotal')::integer is distinct from 0 then
    raise exception 'a customer match listed contacts: %', v_result;
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
