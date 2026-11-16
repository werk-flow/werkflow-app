-- The caller of an open, unmatched Anfrage is compared with the customers of
-- the request's organization only, through the customer duplicate matcher
-- (supabase/tests/client_duplicates.sql owns its reasons): by phone in any
-- common German notation, by email ignoring case, and by name together with
-- the postal code of the captured address. A name alone no longer matches
-- (migrations 20261107200000_promote_caller_with_site_and_find_matches.sql
-- and 20261128090000_find_client_duplicates.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('42000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'caller-match-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Treffer"}', now(), now()),
('42000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'caller-match-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Treffer"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('42000000-0000-0000-0000-000000000010', 'Caller match SQL',
 '42000000-0000-0000-0000-000000000001', 'CALLMTCH'),
('42000000-0000-0000-0000-000000000011', 'Caller match SQL other',
 '42000000-0000-0000-0000-000000000002', 'CALLMTCO');

insert into public.clients (id, organization_id, name, phone, email) values
('42000000-0000-0000-0000-000000000021', '42000000-0000-0000-0000-000000000010',
 'Erika Sommer', '+49 (0)30 4440123', null),
('42000000-0000-0000-0000-000000000022', '42000000-0000-0000-0000-000000000010',
 'Sommer GmbH', null, ' erika.sommer@example.test '),
('42000000-0000-0000-0000-000000000023', '42000000-0000-0000-0000-000000000010',
 'Hausverwaltung Nord', '040 111111', null),
('42000000-0000-0000-0000-000000000024', '42000000-0000-0000-0000-000000000010',
 ' erika   SOMMER ', null, null),
('42000000-0000-0000-0000-000000000025', '42000000-0000-0000-0000-000000000010',
 'Andere Person', '030 4440124', 'andere@example.test'),
('42000000-0000-0000-0000-000000000026', '42000000-0000-0000-0000-000000000010',
 'Kurze Nummer', '150', null),
('42000000-0000-0000-0000-000000000027', '42000000-0000-0000-0000-000000000010',
 'Wohnanlage Süd', null, null),
('42000000-0000-0000-0000-000000000029', '42000000-0000-0000-0000-000000000011',
 'Erika Sommer', '030 44 40 123', 'erika.sommer@example.test');
update public.clients set address = 'Lindenweg 1, 10115 Berlin'
where id = '42000000-0000-0000-0000-000000000021';
insert into public.client_sites (organization_id, client_id, name, street, postal_code, city) values
('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000027',
 'Haus Süd', 'Südring 4', '10115', 'Berlin');
insert into public.client_contacts (organization_id, client_id, name, phone, email) values
('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000023',
 'Frau Sommer', '0049 30 444-0123', null),
('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000027',
 'Erika  Sommer', null, null),
('42000000-0000-0000-0000-000000000011', '42000000-0000-0000-0000-000000000029',
 'Fremder Kontakt', '+49 30 4440123', 'erika.sommer@example.test');

insert into public.client_requests (
  id, organization_id, summary, caller_name, caller_phone, caller_email, caller_address
) values
('42000000-0000-0000-0000-000000000040', '42000000-0000-0000-0000-000000000010', 'Heizung kalt',
 'Erika Sommer', '030 44 40 123', 'Erika.Sommer@Example.test', 'Ahornweg 3, 10115 Berlin'),
('42000000-0000-0000-0000-000000000041', '42000000-0000-0000-0000-000000000010', 'Kurze Nummer',
 null, '150', null, null),
('42000000-0000-0000-0000-000000000049', '42000000-0000-0000-0000-000000000011', 'Fremde Anfrage',
 'Erika Sommer', '030 44 40 123', 'erika.sommer@example.test', 'Ahornweg 3, 10115 Berlin');
insert into public.client_requests (id, organization_id, client_id, summary, caller_name) values
('42000000-0000-0000-0000-000000000042', '42000000-0000-0000-0000-000000000010',
 '42000000-0000-0000-0000-000000000021', 'Schon zugeordnet', 'Erika Sommer');
insert into public.client_requests (
  id, organization_id, summary, caller_name, status, closed_reason, closed_by, closed_at
) values (
  '42000000-0000-0000-0000-000000000043', '42000000-0000-0000-0000-000000000010', 'Geschlossen',
  'Erika Sommer', 'geschlossen', 'duplikat', '42000000-0000-0000-0000-000000000001', now()
);

-- Every common notation of one number compares equal; a fragment is no number.
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    array['030 44 40 123', '0304440123'],
    array['+49 (0)30 4440123', '0304440123'],
    array['0049 30 444-0123', '0304440123'],
    array['030/444 01 23', '0304440123'],
    array['+43 1 234567', '00431234567'],
    array['150', null],
    array['', null]
  ] loop
    if app_private.normalized_phone(v_case[1]) is distinct from v_case[2] then
      raise exception 'phone % normalized to % instead of %',
        v_case[1], app_private.normalized_phone(v_case[1]), v_case[2];
    end if;
  end loop;
  if app_private.normalized_phone(null) is not null then
    raise exception 'a missing phone normalized to a number';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  v_matches text[];
begin
  select array_agg(match.client_id::text || ':' || array_to_string(match.matched_on, ','))
  into v_matches
  from public.find_client_request_caller_matches(
    '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000040', 10) match;

  if v_matches[1] is distinct from '42000000-0000-0000-0000-000000000021:phone,name' then
    raise exception 'the customer matching on phone and name is not listed first: %', v_matches;
  end if;
  if (select array_agg(entry order by entry) from unnest(v_matches) entry) is distinct from array[
    '42000000-0000-0000-0000-000000000021:phone,name',
    '42000000-0000-0000-0000-000000000022:email',
    '42000000-0000-0000-0000-000000000023:phone',
    '42000000-0000-0000-0000-000000000027:name'
  ] then
    raise exception 'the caller matches are not the customers with an equal phone, email, or name and postal code: %', v_matches;
  end if;
  if exists (
    select 1 from unnest(v_matches) entry where entry like '42000000-0000-0000-0000-000000000029:%'
  ) then
    raise exception 'the caller matched a customer of another organization';
  end if;
  if (
    select array_agg(match.client_id)
    from public.find_client_request_caller_matches(
      '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000040', 1) match
  ) is distinct from array['42000000-0000-0000-0000-000000000021'::uuid] then
    raise exception 'the limit did not keep the strongest match only';
  end if;

  if exists (
    select 1 from public.find_client_request_caller_matches(
      '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000041', 10)
  ) then
    raise exception 'a phone fragment matched a customer';
  end if;
  if exists (
    select 1 from public.find_client_request_caller_matches(
      '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000042', 10)
  ) or exists (
    select 1 from public.find_client_request_caller_matches(
      '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000043', 10)
  ) then
    raise exception 'a matched or closed request listed caller matches';
  end if;

  begin
    perform public.find_client_request_caller_matches(
      '42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000049', 10);
    raise exception 'a request of another organization was read';
  exception when others then
    if sqlerrm <> 'request_not_found' then
      raise exception 'a request of another organization refused with % instead of request_not_found', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
declare
  v_role text;
begin
  if not has_function_privilege('service_role',
    'public.find_client_request_caller_matches(uuid, uuid, integer)', 'execute')
  then raise exception 'find_client_request_caller_matches lost its service_role grant'; end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.find_client_request_caller_matches(uuid, uuid, integer)', 'execute')
      or has_function_privilege(v_role, 'app_private.normalized_phone(text)', 'execute')
    then raise exception 'the caller match lookup is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
