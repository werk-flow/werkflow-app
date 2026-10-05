-- Related customer writes apply completely or not at all.
-- A new primary contact or work site clears the previous primary of the same
-- customer inside its own statement, and the database keeps one primary per
-- customer (migration 20261004153000_keep_one_primary_client_contact_and_site.sql).
-- Promoting the caller of an Anfrage creates the customer, links it and
-- records the history row in one call that refuses with the action's failure
-- codes (migration 20261004153100_promote_request_caller_atomically.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41530000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-customer-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Atomar"}', now(), now()),
('41530000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-customer-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Atomar"}', now(), now()),
('41530000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-customer-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Atomar"}', now(), now()),
('41530000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-customer-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Atomar"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41530000-0000-0000-0000-000000000010', 'Atomic customer SQL',
 '41530000-0000-0000-0000-000000000001', 'ATOMCUST'),
('41530000-0000-0000-0000-000000000011', 'Atomic customer SQL other',
 '41530000-0000-0000-0000-000000000004', 'ATOMCUSO');
insert into public.organization_members (organization_id, user_id, role) values
('41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000002', 'buero'),
('41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name) values
('41530000-0000-0000-0000-000000000020', '41530000-0000-0000-0000-000000000010', 'Kunde A'),
('41530000-0000-0000-0000-000000000021', '41530000-0000-0000-0000-000000000010', 'Kunde B'),
('41530000-0000-0000-0000-000000000029', '41530000-0000-0000-0000-000000000011', 'Fremder Kunde');

insert into public.client_requests (id, organization_id, summary, caller_name, caller_phone, caller_email, caller_address)
values
('41530000-0000-0000-0000-000000000040', '41530000-0000-0000-0000-000000000010', 'Heizung kalt',
 'Erika Muster', '0301234567', 'erika@example.test', 'Hauptstraße 1, 10115 Berlin'),
('41530000-0000-0000-0000-000000000041', '41530000-0000-0000-0000-000000000010', 'Ohne Namen',
 null, null, null, null),
('41530000-0000-0000-0000-000000000049', '41530000-0000-0000-0000-000000000011', 'Fremde Anfrage',
 'Fremder Anrufer', null, null, null);
insert into public.client_requests (id, organization_id, client_id, summary) values
('41530000-0000-0000-0000-000000000042', '41530000-0000-0000-0000-000000000010',
 '41530000-0000-0000-0000-000000000020', 'Schon zugeordnet');
insert into public.client_requests (
  id, organization_id, summary, caller_name, status, closed_reason, closed_by, closed_at
) values (
  '41530000-0000-0000-0000-000000000043', '41530000-0000-0000-0000-000000000010', 'Geschlossen',
  'Max Muster', 'geschlossen', 'duplikat', '41530000-0000-0000-0000-000000000001', now()
);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- The primary contact and work site, written the way the server actions write them.
set local role service_role;

do $$
declare
  v_org constant uuid := '41530000-0000-0000-0000-000000000010';
  v_client constant uuid := '41530000-0000-0000-0000-000000000020';
  v_other_client constant uuid := '41530000-0000-0000-0000-000000000021';
  v_first constant uuid := '41530000-0000-0000-0000-000000000031';
  v_second constant uuid := '41530000-0000-0000-0000-000000000032';
  v_other constant uuid := '41530000-0000-0000-0000-000000000033';
  v_first_site constant uuid := '41530000-0000-0000-0000-000000000034';
  v_second_site constant uuid := '41530000-0000-0000-0000-000000000035';
begin
  insert into public.client_contacts (id, organization_id, client_id, name, is_primary) values
    (v_first, v_org, v_client, 'Erste', true),
    (v_other, v_org, v_other_client, 'Andere Kundin', true);
  insert into public.client_contacts (id, organization_id, client_id, name, is_primary)
    values (v_second, v_org, v_client, 'Zweite', true);
  if (select array_agg(id order by id) from public.client_contacts where client_id = v_client and is_primary)
    <> array[v_second]
  then raise exception 'a new primary contact did not replace the previous one'; end if;
  if not (select is_primary from public.client_contacts where id = v_other) then
    raise exception 'a primary contact of another customer was cleared';
  end if;

  update public.client_contacts set is_primary = true where id = v_first;
  if (select array_agg(id order by id) from public.client_contacts where client_id = v_client and is_primary)
    <> array[v_first]
  then raise exception 'marking a contact primary did not replace the previous one'; end if;

  -- The same statement refused later (a missing name): the previous primary stays.
  begin
    insert into public.client_contacts (organization_id, client_id, name, is_primary)
      values (v_org, v_client, null, true);
    raise exception 'a contact without a name was stored';
  exception when not_null_violation then null;
  end;
  if (select array_agg(id order by id) from public.client_contacts where client_id = v_client and is_primary)
    <> array[v_first]
  then raise exception 'a refused primary contact cleared the previous primary'; end if;

  insert into public.client_sites (id, organization_id, client_id, name, is_primary) values
    (v_first_site, v_org, v_client, 'Heizraum', true);
  insert into public.client_sites (id, organization_id, client_id, name, is_primary) values
    (v_second_site, v_org, v_client, 'Dachboden', true);
  if (select array_agg(id order by id) from public.client_sites where client_id = v_client and is_primary)
    <> array[v_second_site]
  then raise exception 'a new primary site did not replace the previous one'; end if;

  begin
    update public.client_sites set is_primary = true, name = null where id = v_first_site;
    raise exception 'a site without a name was stored';
  exception when not_null_violation then null;
  end;
  if (select array_agg(id order by id) from public.client_sites where client_id = v_client and is_primary)
    <> array[v_second_site]
  then raise exception 'a refused primary site cleared the previous primary'; end if;

  update public.client_sites set is_primary = true where id = v_first_site;
  if (select array_agg(id order by id) from public.client_sites where client_id = v_client and is_primary)
    <> array[v_first_site]
  then raise exception 'marking a site primary did not replace the previous one'; end if;
end;
$$;

reset role;

-- No other path stores a second primary: with the triggers bypassed the
-- index refuses it.
set local session_replication_role = replica;
select pg_temp.expect_refusal('a second primary contact past the trigger', $sql$
  insert into public.client_contacts (organization_id, client_id, name, is_primary) values
  ('41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000020', 'Dritte', true)
$sql$, 'duplicate key value violates unique constraint "client_contacts_one_primary_per_client"');
select pg_temp.expect_refusal('a second primary site past the trigger', $sql$
  insert into public.client_sites (organization_id, client_id, name, is_primary) values
  ('41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000020', 'Keller', true)
$sql$, 'duplicate key value violates unique constraint "client_sites_one_primary_per_client"');
set local session_replication_role = origin;

-- Promotion refusals change nothing.
set local role service_role;

select pg_temp.expect_refusal('promotion of a request of another organization', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000001',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000049', null, 'privat')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('promotion by a field worker', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000003',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000040', null, 'privat')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('promotion by an outsider', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000004',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000040', null, 'privat')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('promotion of a closed request', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000043', null, 'privat')
$sql$, 'request_not_editable');
select pg_temp.expect_refusal('promotion of a matched request', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000042', null, 'privat')
$sql$, 'already_matched');
select pg_temp.expect_refusal('promotion without any name', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000041', '  ', 'privat')
$sql$, 'caller_name_required');
select pg_temp.expect_refusal('promotion without a request', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', null, null, 'privat')
$sql$, 'invalid_input');

reset role;

-- The last step refused: the history row cannot be written. Neither the
-- customer nor the link remains.
create function pg_temp.refuse_request_event() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_request_event before insert on public.client_request_events
  for each row execute function pg_temp.refuse_request_event();

set local role service_role;
select pg_temp.expect_refusal('promotion whose history row is refused', $sql$
  select public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000040', null, 'privat')
$sql$, 'history refused');
reset role;

drop trigger refuse_request_event on public.client_request_events;

do $$
begin
  if (select count(*) from public.clients where organization_id = '41530000-0000-0000-0000-000000000010') <> 2
    or (select client_id from public.client_requests where id = '41530000-0000-0000-0000-000000000040') is not null
    or exists (select 1 from public.client_request_events where organization_id = '41530000-0000-0000-0000-000000000010')
    or (select client_id from public.client_requests where id = '41530000-0000-0000-0000-000000000049') is not null
  then raise exception 'a refused promotion changed customers, requests or history'; end if;
end;
$$;

-- A clean promotion creates one customer from the caller fields, links it and records it.
set local role service_role;

do $$
declare
  v_request public.client_requests;
  v_client public.clients;
begin
  v_request := public.promote_client_request_caller('41530000-0000-0000-0000-000000000002',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000040', '  ', 'gewerblich');
  select * into v_client from public.clients where id = v_request.client_id;
  if v_client.id is null
    or v_client.organization_id <> '41530000-0000-0000-0000-000000000010'
    or v_client.name <> 'Erika Muster'
    or v_client.client_type <> 'gewerblich'
    or v_client.email <> 'erika@example.test'
    or v_client.phone <> '0301234567'
    or v_client.address <> 'Hauptstraße 1, 10115 Berlin'
  then raise exception 'a promotion did not create the customer from the caller fields: %', to_jsonb(v_client); end if;
  if (select client_id from public.client_requests where id = '41530000-0000-0000-0000-000000000040') <> v_client.id
  then raise exception 'a promotion did not link the customer'; end if;
  if (
    select array_agg(event_type || ':' || (event_payload ->> 'clientId') || ':' || (event_payload ->> 'clientName')
      || ':' || created_by::text)
    from public.client_request_events where request_id = '41530000-0000-0000-0000-000000000040'
  ) <> array['promoted:' || v_client.id::text || ':Erika Muster:41530000-0000-0000-0000-000000000002']
  then raise exception 'a promotion did not record its history row'; end if;

  -- The typed name wins over the captured caller name.
  v_request := public.promote_client_request_caller('41530000-0000-0000-0000-000000000001',
    '41530000-0000-0000-0000-000000000010', '41530000-0000-0000-0000-000000000041', ' Neue Kundin ', null);
  if (select name || ':' || client_type::text from public.clients where id = v_request.client_id)
    <> 'Neue Kundin:privat'
  then raise exception 'a promotion ignored the typed name or the default type'; end if;
end;
$$;

reset role;

do $$
declare
  v_function constant text := 'public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type)';
  v_role text;
begin
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception '% lost its service_role grant', v_function;
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, v_function, 'execute') then
      raise exception '% is executable by %', v_function, v_role;
    end if;
    if has_function_privilege(v_role, 'app_private.keep_one_primary_client_contact()', 'execute')
      or has_function_privilege(v_role, 'app_private.keep_one_primary_client_site()', 'execute')
    then raise exception 'a primary trigger function is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
