-- A customer with history is archived, not deleted, and every identity change
-- of a customer, contact or site keeps its history
-- (migration 20261129090000_archive_customers_and_keep_master_data_history.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('44000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'archive-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Archiv"}', now(), now()),
('44000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'archive-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Archiv"}', now(), now()),
('44000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'archive-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Archiv"}', now(), now()),
('44000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'archive-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Archiv"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('44000000-0000-0000-0000-000000000010', 'Archive SQL', '44000000-0000-0000-0000-000000000001', 'ARCHSQL'),
('44000000-0000-0000-0000-000000000011', 'Archive SQL other', '44000000-0000-0000-0000-000000000004', 'ARCHSQLO');
insert into public.organization_members (organization_id, user_id, role) values
('44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000002', 'buero'),
('44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000003', 'employee');

-- 20: linked by work; 21: unlinked; 22: linked by a request only; 23: by a
-- follow-up only; 29: another organization's linked customer.
insert into public.clients (id, organization_id, name, phone, email, address) values
('44000000-0000-0000-0000-000000000020', '44000000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', '030 1111111', 'lindenhof@example.test', 'Lindenweg 1, 10115 Berlin'),
('44000000-0000-0000-0000-000000000021', '44000000-0000-0000-0000-000000000010',
 'Versehentlich angelegt', null, null, null),
('44000000-0000-0000-0000-000000000022', '44000000-0000-0000-0000-000000000010',
 'Nur Anfrage', null, null, null),
('44000000-0000-0000-0000-000000000023', '44000000-0000-0000-0000-000000000010',
 'Nur Nachfassen', null, null, null),
('44000000-0000-0000-0000-000000000029', '44000000-0000-0000-0000-000000000011',
 'Fremder Kunde', null, null, null);
insert into public.client_contacts (id, organization_id, client_id, name, phone) values
('44000000-0000-0000-0000-000000000030', '44000000-0000-0000-0000-000000000010',
 '44000000-0000-0000-0000-000000000020', 'Erika Musterfrau', '0171 1111111'),
('44000000-0000-0000-0000-000000000031', '44000000-0000-0000-0000-000000000010',
 '44000000-0000-0000-0000-000000000021', 'Max Mustermann', null);
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('44000000-0000-0000-0000-000000000040', '44000000-0000-0000-0000-000000000010',
 '44000000-0000-0000-0000-000000000020', 'Haus Nord', 'Nordring 2', '10115', 'Berlin');
insert into public.projects (id, organization_id, name, project_number, client_id, created_by) values
('44000000-0000-0000-0000-000000000050', '44000000-0000-0000-0000-000000000010', 'Sanierung',
 'ARCH-P-1', '44000000-0000-0000-0000-000000000020', '44000000-0000-0000-0000-000000000001');
insert into public.jobs (id, organization_id, job_number, title, client_id, created_by) values
('44000000-0000-0000-0000-000000000051', '44000000-0000-0000-0000-000000000010', 'ARCH-J-1', 'Wartung',
 '44000000-0000-0000-0000-000000000020', '44000000-0000-0000-0000-000000000001'),
('44000000-0000-0000-0000-000000000059', '44000000-0000-0000-0000-000000000011', 'ARCH-J-9', 'Fremd',
 '44000000-0000-0000-0000-000000000029', '44000000-0000-0000-0000-000000000004');
insert into public.client_requests (organization_id, client_id, summary) values
('44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000022', 'Heizung kalt');
insert into public.client_follow_ups (
  organization_id, client_id, title, owner_user_id, due_at, created_by, updated_by
) values (
  '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000023', 'Rückruf',
  '44000000-0000-0000-0000-000000000002', '2026-12-01T08:00:00Z',
  '44000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001'
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

-- Browser roles reach neither the history nor the write functions.
do $$
begin
  if has_table_privilege('authenticated', 'public.client_master_events', 'SELECT')
    or has_table_privilege('anon', 'public.client_master_events', 'SELECT')
  then raise exception 'a browser role can read the customer master-data history'; end if;
  if has_function_privilege('authenticated', 'public.set_client_archived(uuid,uuid,uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.delete_unlinked_client(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.update_client_master(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.update_client_contact(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.update_client_site(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.list_customer_page(uuid,text,integer,integer,boolean)', 'EXECUTE')
  then raise exception 'a browser role can run a customer master-data write function'; end if;
end;
$$;

set local role service_role;

-- A linked customer cannot be deleted by any role or path.
do $$
declare
  v_result jsonb;
begin
  v_result := public.delete_unlinked_client(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000020');
  if v_result <> '{"deleted": false, "links": {"jobs": 1, "projects": 1}}'::jsonb then
    raise exception 'deleting a customer with work did not refuse with its links: %', v_result;
  end if;
  v_result := public.delete_unlinked_client(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000022');
  if v_result -> 'links' <> '{"requests": 1}'::jsonb then
    raise exception 'deleting a customer with a request did not refuse: %', v_result;
  end if;
  v_result := public.delete_unlinked_client(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000023');
  if v_result -> 'links' <> '{"follow_ups": 1}'::jsonb then
    raise exception 'deleting a customer with a follow-up did not refuse: %', v_result;
  end if;
end;
$$;
select pg_temp.expect_refusal('the service role deleting a linked customer directly',
  $sql$delete from public.clients where id = '44000000-0000-0000-0000-000000000020'$sql$,
  'client_has_history');
reset role;
select pg_temp.expect_refusal('the table owner deleting a linked customer directly',
  $sql$delete from public.clients where id = '44000000-0000-0000-0000-000000000022'$sql$,
  'client_has_history');
set local role service_role;
do $$
begin
  if (select count(*) from public.clients
      where id in ('44000000-0000-0000-0000-000000000020', '44000000-0000-0000-0000-000000000022',
                   '44000000-0000-0000-0000-000000000023')) <> 3
    or not exists (select 1 from public.jobs where id = '44000000-0000-0000-0000-000000000051'
      and client_id = '44000000-0000-0000-0000-000000000020')
  then raise exception 'a refused deletion removed a linked customer or detached its work'; end if;
end;
$$;

-- The foreign organization, a field worker and an outsider are refused.
select pg_temp.expect_refusal('archiving another organization''s customer',
  $sql$select public.set_client_archived('44000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000029', true)$sql$,
  'client_not_found');
select pg_temp.expect_refusal('a field worker archiving a customer',
  $sql$select public.set_client_archived('44000000-0000-0000-0000-000000000003',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000020', true)$sql$,
  'not_authorized');
select pg_temp.expect_refusal('an outsider deleting a customer',
  $sql$select public.delete_unlinked_client('44000000-0000-0000-0000-000000000004',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000021')$sql$,
  'not_authorized');
select pg_temp.expect_refusal('a field worker changing a customer',
  $sql$select public.update_client_master('44000000-0000-0000-0000-000000000003',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000020', '{"name":"X"}')$sql$,
  'not_authorized');
select pg_temp.expect_refusal('changing another organization''s contact',
  $sql$select public.update_client_contact('44000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000011', '44000000-0000-0000-0000-000000000030', '{"name":"X"}')$sql$,
  'contact_not_found');

-- An unlinked mistaken entry is deleted with its contact.
do $$
declare
  v_result jsonb;
begin
  v_result := public.delete_unlinked_client(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000021');
  if v_result <> '{"deleted": true, "links": {}}'::jsonb
    or exists (select 1 from public.clients where id = '44000000-0000-0000-0000-000000000021')
    or exists (select 1 from public.client_contacts where id = '44000000-0000-0000-0000-000000000031')
  then raise exception 'an unlinked customer was not deleted: %', v_result; end if;
end;
$$;

-- Archive and restore write history with the actor.
do $$
declare
  v_client public.clients;
begin
  v_client := public.set_client_archived(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000020', true);
  if v_client.archived_at is null then raise exception 'archiving did not mark the customer'; end if;
  if not exists (
    select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020' and event.event_type = 'archived'
      and event.actor_id = '44000000-0000-0000-0000-000000000002'
      and event.contact_id is null and event.site_id is null
  ) then raise exception 'archiving wrote no history entry with its actor'; end if;
  if exists (select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020' and event.event_type = 'changed')
  then raise exception 'archiving wrote a field change'; end if;
end;
$$;
select pg_temp.expect_refusal('archiving an archived customer',
  $sql$select public.set_client_archived('44000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000020', true)$sql$,
  'client_already_archived');

-- An archived customer leaves the default list, stays findable under the
-- archived filter and as a likely duplicate, and keeps its work.
do $$
declare
  v_active jsonb := public.list_customer_page(
    '44000000-0000-0000-0000-000000000010', '', 1, 50, false);
  v_archived jsonb := public.list_customer_page(
    '44000000-0000-0000-0000-000000000010', 'Erika', 1, 50, true);
begin
  if v_active -> 'clients' @> '[{"id": "44000000-0000-0000-0000-000000000020"}]'::jsonb
    or (v_active ->> 'total')::integer <> 2
  then raise exception 'an archived customer stayed in the default customer list: %', v_active; end if;
  if (v_archived ->> 'total')::integer <> 1
    or not v_archived -> 'clients' @> '[{"id": "44000000-0000-0000-0000-000000000020"}]'::jsonb
  then raise exception 'the archived filter did not find the archived customer by its contact: %', v_archived; end if;
  if not exists (
    select 1 from public.find_client_duplicates('44000000-0000-0000-0000-000000000010', '',
      'Neuer Kunde', '030 1111111', '', '', 10) match
    where match.client_id = '44000000-0000-0000-0000-000000000020'
  ) then raise exception 'an archived customer was not found as a likely duplicate'; end if;
  if not exists (select 1 from public.jobs where id = '44000000-0000-0000-0000-000000000051'
    and client_id = '44000000-0000-0000-0000-000000000020')
  then raise exception 'archiving detached the customer''s work'; end if;
end;
$$;

do $$
begin
  perform public.set_client_archived(
    '44000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000020', false);
  if (select archived_at from public.clients where id = '44000000-0000-0000-0000-000000000020') is not null
    or not exists (
      select 1 from public.client_master_events event
      where event.client_id = '44000000-0000-0000-0000-000000000020' and event.event_type = 'restored'
        and event.actor_id = '44000000-0000-0000-0000-000000000001')
  then raise exception 'restoring did not unmark the customer or wrote no history entry'; end if;
end;
$$;
select pg_temp.expect_refusal('restoring an active customer',
  $sql$select public.set_client_archived('44000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000020', false)$sql$,
  'client_not_archived');

-- An identity change writes one entry per field with the old and new value
-- and its actor; a note alone writes none.
do $$
declare
  v_count integer;
begin
  perform public.update_client_master(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000020',
    '{"name": "Hausverwaltung Lindenhof GmbH & Co. KG", "phone": null, "notes": "Schlüssel beim Hausmeister", "client_type": "gewerblich"}');
  select count(*) into v_count from public.client_master_events event
  where event.client_id = '44000000-0000-0000-0000-000000000020' and event.event_type = 'changed';
  if v_count <> 3 then raise exception 'a customer change wrote % field entries instead of 3', v_count; end if;
  if not exists (select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020'
      and event.actor_id = '44000000-0000-0000-0000-000000000002'
      and event.event_payload = '{"field": "phone", "old": "030 1111111", "new": null}'::jsonb)
    or not exists (select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020'
      and event.event_payload = '{"field": "name", "old": "Hausverwaltung Lindenhof GmbH", "new": "Hausverwaltung Lindenhof GmbH & Co. KG"}'::jsonb)
  then raise exception 'a customer change did not keep the old and new value with its actor'; end if;
  if exists (select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020' and event.event_payload ->> 'field' = 'notes')
  then raise exception 'a note change was recorded as an identity change'; end if;
  if (select notes from public.clients where id = '44000000-0000-0000-0000-000000000020')
    <> 'Schlüssel beim Hausmeister'
  then raise exception 'the customer change did not save its note'; end if;
end;
$$;

-- Contacts and sites keep their history too, archiving included.
do $$
begin
  perform public.update_client_contact(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000030', '{"phone": "0171 2222222", "role": "Hausmeisterin"}');
  perform public.update_client_site(
    '44000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000010',
    '44000000-0000-0000-0000-000000000040', '{"street": "Nordring 4", "is_active": false}');
  if not exists (select 1 from public.client_master_events event
    where event.contact_id = '44000000-0000-0000-0000-000000000030'
      and event.client_id = '44000000-0000-0000-0000-000000000020'
      and event.event_payload = '{"field": "phone", "old": "0171 1111111", "new": "0171 2222222"}'::jsonb)
  then raise exception 'a contact change wrote no history entry'; end if;
  if exists (select 1 from public.client_master_events event
    where event.contact_id = '44000000-0000-0000-0000-000000000030' and event.event_payload ->> 'field' = 'role')
  then raise exception 'a contact role change was recorded as an identity change'; end if;
  if (select count(*) from public.client_master_events event
      where event.site_id = '44000000-0000-0000-0000-000000000040'
        and (event.event_type = 'archived'
          or event.event_payload = '{"field": "street", "old": "Nordring 2", "new": "Nordring 4"}'::jsonb)) <> 2
  then raise exception 'a site change or its archiving wrote no history entry'; end if;
end;
$$;

-- An identity change without its history entry is impossible: a direct write
-- outside the functions records the change without an actor.
-- (Each Data API call is its own transaction; this one still holds the actor
-- the calls above named, so it forgets it first.)
select set_config('app.client_actor_id', '', true);
update public.clients set email = 'neu@example.test'
where id = '44000000-0000-0000-0000-000000000020';
update public.client_contacts set name = 'Erika Mustermann'
where id = '44000000-0000-0000-0000-000000000030';
do $$
begin
  if not exists (select 1 from public.client_master_events event
    where event.client_id = '44000000-0000-0000-0000-000000000020' and event.actor_id is null
      and event.event_payload = '{"field": "email", "old": "lindenhof@example.test", "new": "neu@example.test"}'::jsonb)
    or not exists (select 1 from public.client_master_events event
    where event.contact_id = '44000000-0000-0000-0000-000000000030' and event.actor_id is null
      and event.event_payload ->> 'field' = 'name')
  then raise exception 'a direct identity change left no history entry'; end if;
end;
$$;

-- The history is append-only for every role.
select pg_temp.expect_refusal('rewriting a history entry',
  $sql$update public.client_master_events set event_payload = '{"field": "name"}'
    where client_id = '44000000-0000-0000-0000-000000000020'$sql$,
  'permission denied for table client_master_events');
reset role;
select pg_temp.expect_refusal('the table owner rewriting a history entry',
  $sql$update public.client_master_events set actor_id = null
    where client_id = '44000000-0000-0000-0000-000000000020'$sql$,
  'event_ledger_history_immutable');
select pg_temp.expect_refusal('the table owner deleting a history entry',
  $sql$delete from public.client_master_events where client_id = '44000000-0000-0000-0000-000000000020'$sql$,
  'event_ledger_history_immutable');

-- Organization teardown still removes linked customers and their history.
delete from public.organizations where id = '44000000-0000-0000-0000-000000000011';
delete from public.organizations where id = '44000000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.clients where organization_id in (
      '44000000-0000-0000-0000-000000000010', '44000000-0000-0000-0000-000000000011'))
    or exists (select 1 from public.client_master_events where organization_id =
      '44000000-0000-0000-0000-000000000010')
  then raise exception 'organization teardown left customers or their history'; end if;
end;
$$;

rollback;
