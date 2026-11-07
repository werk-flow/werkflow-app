-- The caller of an open, unmatched Anfrage is compared with the customers of
-- the request's organization only: by phone in any common German notation, by
-- email ignoring case, and by name ignoring case and repeated spaces, each on
-- the customer or one of its contacts (migration
-- 20261107200000_promote_caller_with_site_and_find_matches.sql).
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
 'Anna Hartwig', '+49 (0)30 5557150', null),
('42000000-0000-0000-0000-000000000022', '42000000-0000-0000-0000-000000000010',
 'Hartwig GmbH', null, ' anna.hartwig@example.test '),
('42000000-0000-0000-0000-000000000023', '42000000-0000-0000-0000-000000000010',
 'Hausverwaltung Nord', '040 111111', null),
('42000000-0000-0000-0000-000000000024', '42000000-0000-0000-0000-000000000010',
 ' anna   HARTWIG ', null, null),
('42000000-0000-0000-0000-000000000025', '42000000-0000-0000-0000-000000000010',
 'Andere Person', '030 5557151', 'andere@example.test'),
('42000000-0000-0000-0000-000000000026', '42000000-0000-0000-0000-000000000010',
 'Kurze Nummer', '150', null),
('42000000-0000-0000-0000-000000000027', '42000000-0000-0000-0000-000000000010',
 'Wohnanlage Süd', null, null),
('42000000-0000-0000-0000-000000000029', '42000000-0000-0000-0000-000000000011',
 'Anna Hartwig', '030 55 57 150', 'anna.hartwig@example.test');
insert into public.client_contacts (organization_id, client_id, name, phone, email) values
('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000023',
 'Frau Hartwig', '0049 30 555-7150', null),
('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000027',
 'Anna  Hartwig', null, null),
('42000000-0000-0000-0000-000000000011', '42000000-0000-0000-0000-000000000029',
 'Fremder Kontakt', '+49 30 5557150', 'anna.hartwig@example.test');

insert into public.client_requests (id, organization_id, summary, caller_name, caller_phone, caller_email)
values
('42000000-0000-0000-0000-000000000040', '42000000-0000-0000-0000-000000000010', 'Heizung kalt',
 'Anna Hartwig', '030 55 57 150', 'Anna.Hartwig@Example.test'),
('42000000-0000-0000-0000-000000000041', '42000000-0000-0000-0000-000000000010', 'Kurze Nummer',
 null, '150', null),
('42000000-0000-0000-0000-000000000049', '42000000-0000-0000-0000-000000000011', 'Fremde Anfrage',
 'Anna Hartwig', '030 55 57 150', 'anna.hartwig@example.test');
insert into public.client_requests (id, organization_id, client_id, summary, caller_name) values
('42000000-0000-0000-0000-000000000042', '42000000-0000-0000-0000-000000000010',
 '42000000-0000-0000-0000-000000000021', 'Schon zugeordnet', 'Anna Hartwig');
insert into public.client_requests (
  id, organization_id, summary, caller_name, status, closed_reason, closed_by, closed_at
) values (
  '42000000-0000-0000-0000-000000000043', '42000000-0000-0000-0000-000000000010', 'Geschlossen',
  'Anna Hartwig', 'geschlossen', 'duplikat', '42000000-0000-0000-0000-000000000001', now()
);

-- Every common notation of one number compares equal; a fragment is no number.
do $$
declare
  v_case text[];
begin
  foreach v_case slice 1 in array array[
    array['030 55 57 150', '0305557150'],
    array['+49 (0)30 5557150', '0305557150'],
    array['0049 30 555-7150', '0305557150'],
    array['030/555 71 50', '0305557150'],
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

  if v_matches[1] <> '42000000-0000-0000-0000-000000000021:phone,name' then
    raise exception 'the customer matching on phone and name is not listed first: %', v_matches;
  end if;
  if (select array_agg(entry order by entry) from unnest(v_matches) entry) <> array[
    '42000000-0000-0000-0000-000000000021:phone,name',
    '42000000-0000-0000-0000-000000000022:email',
    '42000000-0000-0000-0000-000000000023:phone',
    '42000000-0000-0000-0000-000000000024:name',
    '42000000-0000-0000-0000-000000000027:name'
  ] then
    raise exception 'the caller matches are not the customers with an equal phone, email or name: %', v_matches;
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
  ) <> array['42000000-0000-0000-0000-000000000021'::uuid] then
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
