-- An Objekt knows its owner, manager, payer and access contacts over time
-- (migration 20261130090003_record_dated_objekt_roles.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('45000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'roles-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Rollen"}', now(), now()),
('45000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'roles-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Rollen"}', now(), now()),
('45000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'roles-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Rollen"}', now(), now()),
('45000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'roles-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Rollen"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('45000000-0000-0000-0000-000000000010', 'Roles SQL', '45000000-0000-0000-0000-000000000001', 'ROLESQL'),
('45000000-0000-0000-0000-000000000011', 'Roles SQL other', '45000000-0000-0000-0000-000000000004', 'ROLESQLO');
insert into public.organization_members (organization_id, user_id, role) values
('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000002', 'buero'),
('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000003', 'employee');

-- 20: the WEG the Objekt is filed under; 21 and 22: two Hausverwaltungen;
-- 23: an archived customer; 24: an unlinked customer with its own role;
-- 29: another organization's customer.
insert into public.clients (id, organization_id, name, client_type, source_number) values
('45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'K-1001'),
('45000000-0000-0000-0000-000000000021', '45000000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', null),
('45000000-0000-0000-0000-000000000022', '45000000-0000-0000-0000-000000000010',
 'Hausverwaltung Birkenhain GmbH', 'gewerblich', null),
('45000000-0000-0000-0000-000000000023', '45000000-0000-0000-0000-000000000010',
 'Archivierte Verwaltung', 'gewerblich', null),
('45000000-0000-0000-0000-000000000024', '45000000-0000-0000-0000-000000000010',
 'Erika Musterfrau', 'privat', null),
('45000000-0000-0000-0000-000000000029', '45000000-0000-0000-0000-000000000011',
 'Fremde Verwaltung', 'gewerblich', null);
update public.clients set archived_at = now() where id = '45000000-0000-0000-0000-000000000023';
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city, source_number) values
('45000000-0000-0000-0000-000000000040', '45000000-0000-0000-0000-000000000010',
 '45000000-0000-0000-0000-000000000020', 'Haus Lindenstraße', 'Lindenstraße 5', '10115', 'Berlin', 'OBJ-77'),
('45000000-0000-0000-0000-000000000041', '45000000-0000-0000-0000-000000000010',
 '45000000-0000-0000-0000-000000000024', 'Wohnhaus', 'Birkenweg 2', '20095', 'Hamburg', null),
('45000000-0000-0000-0000-000000000049', '45000000-0000-0000-0000-000000000011',
 '45000000-0000-0000-0000-000000000029', 'Fremdes Haus', 'Fremdweg 1', '10115', 'Berlin', null);
set local app.installed_equipment_write = 'true';
insert into public.installed_equipment (
  id, organization_id, client_id, site_id, equipment_number, name, category, state, created_by, updated_by
) values (
  '45000000-0000-0000-0000-000000000060', '45000000-0000-0000-0000-000000000010',
  '45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000040',
  'ROLES-A-1', 'Gasbrennwerttherme Keller', 'heat_generation', 'active',
  '45000000-0000-0000-0000-000000000001', '45000000-0000-0000-0000-000000000001'
);
reset app.installed_equipment_write;

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

-- Browser roles reach the rows only through the manager policy and none of
-- the functions.
do $$
begin
  if has_table_privilege('anon', 'public.client_site_roles', 'SELECT')
    or has_table_privilege('authenticated', 'public.client_site_roles', 'INSERT')
    or has_table_privilege('authenticated', 'public.client_site_roles', 'UPDATE')
    or has_table_privilege('service_role', 'public.client_site_roles', 'DELETE')
  then raise exception 'a role can write or delete Objekt roles outside the write functions'; end if;
  if has_function_privilege('authenticated', 'public.assign_client_site_role(uuid,uuid,uuid,text,uuid,boolean,date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.end_client_site_role(uuid,uuid,uuid,date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.list_client_site_roles(uuid,uuid)', 'EXECUTE')
  then raise exception 'a browser role can run an Objekt role function'; end if;
end;
$$;

set local role service_role;

-- Roles stay inside the organization, and only a manager records them.
select pg_temp.expect_refusal('a role on another organization''s Objekt',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000049', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000021', false, null)$sql$,
  'site_not_found');
select pg_temp.expect_refusal('another organization''s customer as holder',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000029', false, null)$sql$,
  'holder_not_found');
select pg_temp.expect_refusal('a field worker recording a role',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000003',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000021', false, null)$sql$,
  'not_authorized');
select pg_temp.expect_refusal('an outsider recording a role',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000004',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000021', false, null)$sql$,
  'not_authorized');
select pg_temp.expect_refusal('an archived customer as new holder',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000023', false, null)$sql$,
  'holder_archived');
select pg_temp.expect_refusal('an unknown role kind',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'mieter',
    '45000000-0000-0000-0000-000000000021', false, null)$sql$,
  'invalid_input');
reset role;
do $$
begin
  begin
    insert into public.client_site_roles (organization_id, site_id, client_id, holder_client_id, role)
    values ('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040',
      '45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000029', 'eigentuemer');
  exception when foreign_key_violation then return;
  end;
  raise exception 'a direct insert linked another organization''s customer as holder';
end;
$$;
set local role service_role;

-- Lindenhof manages the Objekt since an unknown day; the WEG owns it and pays.
do $$
declare
  v_role public.client_site_roles;
begin
  v_role := public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000021', false, null);
  if v_role.client_id <> '45000000-0000-0000-0000-000000000020' or v_role.starts_on is not null
    or v_role.created_by <> '45000000-0000-0000-0000-000000000002'
  then raise exception 'the recorded role does not name its Objekt''s customer and actor: %', v_role; end if;
  perform public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'eigentuemer',
    '45000000-0000-0000-0000-000000000020', false, '2020-01-01');
  perform public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'rechnungsempfaenger',
    '45000000-0000-0000-0000-000000000020', false, '2020-01-01');
end;
$$;

-- Overlapping roles of one kind on one Objekt are refused, by the function
-- and by the table for every writer.
select pg_temp.expect_refusal('a second Hausverwaltung at the same time',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000022', false, '2026-07-01')$sql$,
  'role_overlaps');
reset role;
do $$
begin
  begin
    insert into public.client_site_roles (organization_id, site_id, client_id, holder_client_id, role, starts_on, ends_on)
    values ('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040',
      '45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000022', 'eigentuemer',
      '2019-01-01', '2020-01-01');
  exception when exclusion_violation then return;
  end;
  raise exception 'the table accepted an overlapping owner';
end;
$$;
set local role service_role;

-- A change of Hausverwaltung ends the old role the day before and keeps it.
do $$
declare
  v_new public.client_site_roles;
  v_old public.client_site_roles;
begin
  v_new := public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000022', true, '2026-07-01');
  select * into v_old from public.client_site_roles
  where site_id = '45000000-0000-0000-0000-000000000040' and role = 'hausverwaltung'
    and holder_client_id = '45000000-0000-0000-0000-000000000021';
  if v_old.ends_on is distinct from '2026-06-30'::date
    or v_old.ended_by is distinct from '45000000-0000-0000-0000-000000000002'
    or v_new.starts_on <> '2026-07-01'::date or v_new.ends_on is not null
  then raise exception 'the change did not end the previous Hausverwaltung the day before: % %', v_old, v_new; end if;
  if (select count(*) from public.client_site_roles where site_id = '45000000-0000-0000-0000-000000000040'
      and role = 'hausverwaltung') <> 2
  then raise exception 'the change overwrote the previous Hausverwaltung'; end if;
  -- Both customers and the Objekt's customer keep the history with its actor.
  if (select count(*) from public.client_master_events
      where event_type = 'role_ended' and actor_id = '45000000-0000-0000-0000-000000000002'
        and site_id = '45000000-0000-0000-0000-000000000040'
        and event_payload ->> 'holder_client_id' = '45000000-0000-0000-0000-000000000021'
        and event_payload ->> 'ends_on' = '2026-06-30'
        and client_id in ('45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000021')) <> 2
    or (select count(*) from public.client_master_events
      where event_type = 'role_started' and event_payload ->> 'holder_name' = 'Hausverwaltung Birkenhain GmbH'
        and client_id in ('45000000-0000-0000-0000-000000000020', '45000000-0000-0000-0000-000000000022')) <> 2
    or (select count(*) from public.client_master_events
      where event_type = 'role_started' and event_payload ->> 'role' = 'eigentuemer') <> 1
  then raise exception 'a role change wrote no history for the Objekt''s customer and both holders'; end if;
end;
$$;
select pg_temp.expect_refusal('changing to the current holder',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000022', true, '2026-08-01')$sql$,
  'holder_unchanged');
select pg_temp.expect_refusal('a change dated before the current role started',
  $sql$select public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000040', 'hausverwaltung',
    '45000000-0000-0000-0000-000000000021', true, '2026-07-01')$sql$,
  'role_starts_before_current');

-- Ending a role keeps it as history; it ends once.
do $$
declare
  v_owner uuid := (select id from public.client_site_roles
    where site_id = '45000000-0000-0000-0000-000000000040' and role = 'eigentuemer');
  v_role public.client_site_roles;
begin
  perform pg_temp.expect_refusal('an end before the start',
    format($sql$select public.end_client_site_role('45000000-0000-0000-0000-000000000002',
      '45000000-0000-0000-0000-000000000010', %L, '2019-12-31')$sql$, v_owner),
    'role_ends_before_start');
  perform pg_temp.expect_refusal('a field worker ending a role',
    format($sql$select public.end_client_site_role('45000000-0000-0000-0000-000000000003',
      '45000000-0000-0000-0000-000000000010', %L, '2037-12-31')$sql$, v_owner),
    'not_authorized');
  perform pg_temp.expect_refusal('ending a role through another organization',
    format($sql$select public.end_client_site_role('45000000-0000-0000-0000-000000000002',
      '45000000-0000-0000-0000-000000000011', %L, '2037-12-31')$sql$, v_owner),
    'role_not_found');
  v_role := public.end_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', v_owner, '2037-12-31');
  if v_role.ends_on <> '2037-12-31'::date or v_role.holder_client_id <> '45000000-0000-0000-0000-000000000020'
  then raise exception 'ending a role did not keep it with its end: %', v_role; end if;
  perform pg_temp.expect_refusal('ending an ended role',
    format($sql$select public.end_client_site_role('45000000-0000-0000-0000-000000000002',
      '45000000-0000-0000-0000-000000000010', %L, '2038-01-31')$sql$, v_owner),
    'role_already_ended');
  perform pg_temp.expect_refusal('rewriting an ended role directly',
    format($sql$update public.client_site_roles set ends_on = '2038-06-30' where id = %L$sql$, v_owner),
    'client_site_role_history_immutable');
  perform pg_temp.expect_refusal('moving a role to another holder directly',
    format($sql$update public.client_site_roles set holder_client_id = '45000000-0000-0000-0000-000000000021'
      where id = %L$sql$, v_owner),
    'client_site_role_history_immutable');
end;
$$;
select pg_temp.expect_refusal('the service role deleting a role',
  $sql$delete from public.client_site_roles where site_id = '45000000-0000-0000-0000-000000000040'$sql$,
  'permission denied for table client_site_roles');

-- Tenants and access contacts are contacts at an Objekt of their own customer.
insert into public.client_contacts (id, organization_id, client_id, name, phone, site_id, site_role) values
('45000000-0000-0000-0000-000000000030', '45000000-0000-0000-0000-000000000010',
 '45000000-0000-0000-0000-000000000020', 'Max Mieter', '0171 2222222',
 '45000000-0000-0000-0000-000000000040', 'mieter');
do $$
begin
  begin
    insert into public.client_contacts (organization_id, client_id, name, site_id, site_role) values
    ('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000021', 'Falscher Mieter',
     '45000000-0000-0000-0000-000000000040', 'mieter');
  exception when foreign_key_violation then
    begin
      insert into public.client_contacts (organization_id, client_id, name, site_id) values
      ('45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000020', 'Ohne Rolle',
       '45000000-0000-0000-0000-000000000040');
    exception when check_violation then return;
    end;
    raise exception 'a contact was linked to an Objekt without a role';
  end;
  raise exception 'a contact was linked to another customer''s Objekt';
end;
$$;
do $$
declare
  v_contact public.client_contacts;
begin
  v_contact := public.update_client_contact('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000030',
    '{"site_role": "zugangskontakt"}');
  if v_contact.site_role <> 'zugangskontakt' or not exists (
    select 1 from public.client_master_events where contact_id = v_contact.id
      and event_payload ->> 'field' = 'site_role' and event_payload ->> 'new' = 'zugangskontakt'
  ) then raise exception 'changing a contact''s role at the Objekt kept no history'; end if;
end;
$$;

-- Source numbers are unique per organization, kept in history and searchable.
select pg_temp.expect_refusal('a second customer with the same source number',
  $sql$select public.update_client_master('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000021',
    '{"source_number": "k-1001"}')$sql$,
  'duplicate key value violates unique constraint "clients_source_number_per_org"');
insert into public.client_sites (organization_id, client_id, name, source_number) values
('45000000-0000-0000-0000-000000000011', '45000000-0000-0000-0000-000000000029', 'Gleiche Nummer', 'OBJ-77');
do $$
declare
  v_site public.client_sites;
begin
  v_site := public.update_client_site('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000041', '{"source_number": "OBJ-78"}');
  if not exists (select 1 from public.client_master_events where site_id = v_site.id
      and event_payload ->> 'field' = 'source_number' and event_payload ->> 'new' = 'OBJ-78')
  then raise exception 'a source number change kept no history'; end if;
end;
$$;

-- The search finds the Objekt by street, postal code or source number under
-- its customer and its current Hausverwaltung, with roles and Anlagen; the
-- former Hausverwaltung is not found by it.
do $$
declare
  v_search text;
  v_page jsonb;
  v_ids jsonb;
  v_site jsonb;
begin
  foreach v_search in array array['Lindenstraße 5', '10115', 'obj-77'] loop
    v_page := public.list_customer_page('45000000-0000-0000-0000-000000000010', v_search, 1, 50, false);
    select jsonb_agg(client -> 'id' order by client ->> 'name') into v_ids from jsonb_array_elements(v_page -> 'clients') client;
    if v_ids <> '["45000000-0000-0000-0000-000000000022", "45000000-0000-0000-0000-000000000020"]'::jsonb
    then raise exception 'searching % did not find the Objekt''s customer and current Hausverwaltung: %', v_search, v_page; end if;
    v_site := v_page -> 'clients' -> 0 -> 'matchedSites' -> 0;
    if v_site ->> 'id' <> '45000000-0000-0000-0000-000000000040'
      or v_site ->> 'clientName' <> 'WEG Lindenstraße 5'
      or v_site -> 'equipment' <> '[{"id": "45000000-0000-0000-0000-000000000060", "name": "Gasbrennwerttherme Keller", "equipmentNumber": "ROLES-A-1"}]'::jsonb
      or (v_site ->> 'equipmentTotal')::integer <> 1
      or not v_site -> 'roles' @> '[{"role": "eigentuemer", "holderName": "WEG Lindenstraße 5"}]'::jsonb
      or (v_page -> 'clients' -> 0 ->> 'matchedSiteTotal')::integer <> 1
    then raise exception 'searching % did not show the Objekt with its roles and Anlagen: %', v_search, v_site; end if;
  end loop;
  v_page := public.list_customer_page('45000000-0000-0000-0000-000000000010', 'k-1001', 1, 50, false);
  if (v_page ->> 'total')::integer <> 1 or v_page -> 'clients' -> 0 ->> 'id' <> '45000000-0000-0000-0000-000000000020'
    or v_page -> 'clients' -> 0 -> 'matchedSites' <> '[]'::jsonb
  then raise exception 'the customer source number did not find its customer alone: %', v_page; end if;
end;
$$;

-- The roles read lists both sides and the history.
do $$
begin
  if (select count(*) from public.list_client_site_roles(
      '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000020')) <> 4
    or (select count(*) from public.list_client_site_roles(
      '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000021')) <> 1
    or exists (select 1 from public.list_client_site_roles(
      '45000000-0000-0000-0000-000000000011', '45000000-0000-0000-0000-000000000020'))
  then raise exception 'the roles read missed a side, the history or the organization'; end if;
end;
$$;

-- A role between two customers keeps both; an own role is no link.
do $$
declare
  v_result jsonb;
begin
  v_result := public.delete_unlinked_client('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000021');
  if v_result <> '{"deleted": false, "links": {"site_roles": 1}}'::jsonb
  then raise exception 'deleting a former Hausverwaltung did not refuse with its role: %', v_result; end if;
  perform public.assign_client_site_role('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000041', 'eigentuemer',
    '45000000-0000-0000-0000-000000000024', false, null);
  v_result := public.delete_unlinked_client('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000024');
  if v_result <> '{"deleted": true, "links": {}}'::jsonb
    or exists (select 1 from public.client_site_roles where site_id = '45000000-0000-0000-0000-000000000041')
  then raise exception 'an unlinked owner of its own Objekt was not deleted: %', v_result; end if;
end;
$$;

-- An archived customer keeps its roles as history.
do $$
begin
  perform public.set_client_archived('45000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000010', '45000000-0000-0000-0000-000000000022', true);
  if not exists (select 1 from public.client_site_roles where holder_client_id = '45000000-0000-0000-0000-000000000022'
      and ends_on is null)
  then raise exception 'archiving a Hausverwaltung ended or removed its role'; end if;
end;
$$;

rollback;
