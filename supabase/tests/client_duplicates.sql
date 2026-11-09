-- A draft customer is compared with the customers of its organization only,
-- and each reason fires on its own: the customer number, the phone in any
-- notation, the email in any case (each on the customer or one of its
-- contacts, archived ones included), the name with the postal code, and the
-- street with the postal code of the main address or of a site, archived ones
-- included. A name or a street alone is no match (migration
-- 20261128090000_find_client_duplicates.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('43000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'duplicate-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Dublette"}', now(), now()),
('43000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'duplicate-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Dublette"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('43000000-0000-0000-0000-000000000010', 'Duplicate SQL',
 '43000000-0000-0000-0000-000000000001', 'DUPLMTCH'),
('43000000-0000-0000-0000-000000000011', 'Duplicate SQL other',
 '43000000-0000-0000-0000-000000000002', 'DUPLMTCO');

insert into public.clients (id, organization_id, name, customer_number, phone, email, address) values
('43000000-0000-0000-0000-000000000021', '43000000-0000-0000-0000-000000000010',
 'Nummernkunde', 'K-1001', null, null, null),
('43000000-0000-0000-0000-000000000022', '43000000-0000-0000-0000-000000000010',
 'Telefonkunde', null, '+49 (0)30 4440123', null, null),
('43000000-0000-0000-0000-000000000023', '43000000-0000-0000-0000-000000000010',
 'Kontakttelefon', null, null, null, null),
('43000000-0000-0000-0000-000000000024', '43000000-0000-0000-0000-000000000010',
 'Mailkunde', null, null, ' Erika.Musterfrau@Example.TEST ', null),
('43000000-0000-0000-0000-000000000025', '43000000-0000-0000-0000-000000000010',
 'Kontaktmail', null, null, null, null),
('43000000-0000-0000-0000-000000000026', '43000000-0000-0000-0000-000000000010',
 'Erika Musterfrau', null, null, null, 'Lindenweg 1, 12345 Musterstadt'),
('43000000-0000-0000-0000-000000000027', '43000000-0000-0000-0000-000000000010',
 ' erika   MUSTERFRAU ', null, null, null, 'Ahornstraße 9, 54321 Anderswo'),
('43000000-0000-0000-0000-000000000028', '43000000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', null, null, null, null),
('43000000-0000-0000-0000-000000000029', '43000000-0000-0000-0000-000000000010',
 'Wohnanlage Ahorn', null, null, null, null),
('43000000-0000-0000-0000-000000000030', '43000000-0000-0000-0000-000000000010',
 'Ahorn Eigentümer', null, null, null, 'Ahorn Strasse 9 12345 Musterstadt'),
('43000000-0000-0000-0000-000000000031', '43000000-0000-0000-0000-000000000010',
 'Doppeltreffer', null, '0304440123', null, null),
('43000000-0000-0000-0000-000000000032', '43000000-0000-0000-0000-000000000010',
 'Unbeteiligt', 'K-1002', '030 4440124', 'andere@example.test', 'Ahornstraße 10, 12345 Musterstadt'),
('43000000-0000-0000-0000-000000000039', '43000000-0000-0000-0000-000000000011',
 'Erika Musterfrau', 'K-1001', '030 444 0123', 'erika.musterfrau@example.test',
 'Ahornstraße 9, 12345 Musterstadt');
insert into public.client_contacts (organization_id, client_id, name, phone, email, is_active) values
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000023',
 'Herr Anders', '0049 30 444-0123', null, false),
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000025',
 'Frau Anders', null, 'ERIKA.MUSTERFRAU@example.test', false),
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000028',
 'Erika Musterfrau', null, null, true),
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000031',
 'Herr Doppel', null, 'erika.musterfrau@example.test', true),
('43000000-0000-0000-0000-000000000011', '43000000-0000-0000-0000-000000000039',
 'Erika Musterfrau', '030 444 0123', 'erika.musterfrau@example.test', true);
insert into public.client_sites (organization_id, client_id, name, street, postal_code, city, is_active) values
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000028',
 'Altbau', 'Birkenweg 2', '12345', 'Musterstadt', false),
('43000000-0000-0000-0000-000000000010', '43000000-0000-0000-0000-000000000029',
 'Haus 9', 'Ahornstr. 9', '12345', 'Musterstadt', false),
('43000000-0000-0000-0000-000000000011', '43000000-0000-0000-0000-000000000039',
 'Fremder Ort', 'Ahornstraße 9', '12345', 'Musterstadt', true);

-- Each normalization compares what a person means, not how it was typed.
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    array['email', ' Erika.Musterfrau@Example.TEST ', 'erika.musterfrau@example.test'],
    array['email', '   ', null],
    array['name', ' erika   MUSTERFRAU ', 'erika musterfrau'],
    array['name', '', null],
    array['postal', 'Ahornstraße 9, 12345 Musterstadt', '12345'],
    array['postal', 'D-12345', '12345'],
    array['postal', 'Ahornstraße 9', null],
    array['postal', '123456', null],
    array['street', 'Ahornstraße 9', 'ahornstr9'],
    array['street', 'Ahorn Strasse 9', 'ahornstr9'],
    array['street', 'Ahornstr. 9', 'ahornstr9'],
    array['street', 'Ahorn-Str 9,', 'ahornstr9'],
    array['street', ' , ', null],
    array['address', 'Ahornstraße 9, 12345 Musterstadt', 'Ahornstraße 9,'],
    array['address', 'Ahorn Strasse 9 12345 Musterstadt', 'Ahorn Strasse 9'],
    array['address', 'Ahornstraße 9, D-12345 Musterstadt', 'Ahornstraße 9,'],
    array['address', 'Ahornstraße 9 DE-12345 Musterstadt', 'Ahornstraße 9'],
    array['address', 'Musterstadt', null]
  ] loop
    if (case v_case[1]
      when 'email' then app_private.normalized_email(v_case[2])
      when 'name' then app_private.normalized_name(v_case[2])
      when 'postal' then app_private.postal_code(v_case[2])
      when 'street' then app_private.street_key(v_case[2])
      when 'address' then app_private.address_street(v_case[2])
    end) is distinct from v_case[3] then
      raise exception '% of % is not %', v_case[1], v_case[2], v_case[3];
    end if;
  end loop;
end;
$$;

set local role service_role;

do $$
declare
  v_matches text[];
begin
  select array_agg(match.client_id::text || ':' || array_to_string(match.matched_on, ','))
  into v_matches
  from public.find_client_duplicates(
    '43000000-0000-0000-0000-000000000010', ' k-1001 ', 'Erika  MUSTERFRAU', '030 444 0123',
    'erika.musterfrau@example.test', 'Ahornstraße 9, 12345 Musterstadt', 20) match;

  if v_matches[1] <> '43000000-0000-0000-0000-000000000031:phone,email' then
    raise exception 'the customer with two reasons is not listed first: %', v_matches;
  end if;
  if (select array_agg(entry order by entry) from unnest(v_matches) entry) <> array[
    '43000000-0000-0000-0000-000000000021:customer_number',
    '43000000-0000-0000-0000-000000000022:phone',
    '43000000-0000-0000-0000-000000000023:phone',
    '43000000-0000-0000-0000-000000000024:email',
    '43000000-0000-0000-0000-000000000025:email',
    '43000000-0000-0000-0000-000000000026:name',
    '43000000-0000-0000-0000-000000000028:name',
    '43000000-0000-0000-0000-000000000029:address',
    '43000000-0000-0000-0000-000000000030:address',
    '43000000-0000-0000-0000-000000000031:phone,email'
  ] then
    raise exception 'the duplicates are not the customers with one of the reasons: %', v_matches;
  end if;
  if exists (
    select 1 from unnest(v_matches) entry where entry like '43000000-0000-0000-0000-000000000039:%'
  ) then
    raise exception 'the draft matched a customer of another organization';
  end if;

  if (
    select array_agg(match.client_id)
    from public.find_client_duplicates(
      '43000000-0000-0000-0000-000000000010', 'K-1001', 'Erika Musterfrau', '030 444 0123',
      'erika.musterfrau@example.test', 'Ahornstraße 9, 12345 Musterstadt', 1) match
  ) <> array['43000000-0000-0000-0000-000000000031'::uuid] then
    raise exception 'the limit did not keep the strongest match only';
  end if;

  if exists (
    select 1 from public.find_client_duplicates(
      '43000000-0000-0000-0000-000000000010', null, 'Erika Musterfrau', null, null, null, 20)
  ) then
    raise exception 'a name without a postal code matched a customer';
  end if;
  if exists (
    select 1 from public.find_client_duplicates(
      '43000000-0000-0000-0000-000000000010', null, null, null, null, 'Ahornstraße 9', 20)
  ) then
    raise exception 'a street without a postal code matched a customer';
  end if;
  if exists (
    select 1 from public.find_client_duplicates(
      '43000000-0000-0000-0000-000000000010', ' ', ' ', '150', ' ', ' ', 20)
  ) then
    raise exception 'a blank draft matched a customer';
  end if;

  begin
    perform public.find_client_duplicates(null, 'K-1001', null, null, null, null, 20);
    raise exception 'a lookup without an organization ran';
  exception when others then
    if sqlerrm <> 'invalid_input' then
      raise exception 'a lookup without an organization refused with % instead of invalid_input', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
declare
  v_role text;
  v_function text;
begin
  if not has_function_privilege('service_role',
    'public.find_client_duplicates(uuid, text, text, text, text, text, integer)', 'execute')
  then raise exception 'find_client_duplicates lost its service_role grant'; end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_function in array array[
      'public.find_client_duplicates(uuid, text, text, text, text, text, integer)',
      'app_private.normalized_name(text)',
      'app_private.normalized_email(text)',
      'app_private.postal_code(text)',
      'app_private.street_key(text)',
      'app_private.address_street(text)'
    ] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
