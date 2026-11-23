-- The office creates an offer for the right customer and recipient, and finds
-- it again (migration 20261210130000_keep_offers_for_the_right_customer_and_recipient.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38040000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offer-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38040000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offer-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38040000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offer-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38040000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'offer-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38040000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Angebote', '38040000-0000-4000-8000-000000000001', 'OFFERSQL'),
('38040000-0000-4000-8000-000000000011', 'Fremde Haustechnik Angebote', '38040000-0000-4000-8000-000000000004', 'OFFERSQO');
insert into public.organization_members (organization_id, user_id, role) values
('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000002', 'buero'),
('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000003', 'employee');

-- 20: the customer, 21: its Hausverwaltung, 22: archived, 29: another organization's.
insert into public.clients (id, organization_id, name, client_type, address, archived_at) values
('38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'Lindenstraße 5, 10115 Berlin', null),
('38040000-0000-4000-8000-000000000021', '38040000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin', null),
('38040000-0000-4000-8000-000000000022', '38040000-0000-4000-8000-000000000010',
 'Alte Kundin', 'privat', null, now()),
('38040000-0000-4000-8000-000000000029', '38040000-0000-4000-8000-000000000011',
 'Fremde Kundin', 'privat', null, null);
-- 30: the Hausverwaltung receives its invoices; 31: no role; 32: the customer
-- holds the role itself; 33: the Hausverwaltung's role ended; 39: foreign.
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('38040000-0000-4000-8000-000000000030', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000020', 'Haus Lindenstraße', 'Lindenstraße 5', '10115', 'Berlin'),
('38040000-0000-4000-8000-000000000031', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000020', 'Garage', 'Lindenstraße 7', '10115', 'Berlin'),
('38040000-0000-4000-8000-000000000032', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000020', 'Hinterhaus', 'Lindenstraße 5a', '10115', 'Berlin'),
('38040000-0000-4000-8000-000000000033', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000020', 'Seitenflügel', 'Lindenstraße 5b', '10115', 'Berlin'),
('38040000-0000-4000-8000-000000000039', '38040000-0000-4000-8000-000000000011',
 '38040000-0000-4000-8000-000000000029', 'Fremdes Haus', 'Weg 1', '10115', 'Berlin');
insert into public.client_site_roles (organization_id, site_id, client_id, holder_client_id, role, starts_on, ends_on) values
('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000030',
 '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000021', 'rechnungsempfaenger', null, null),
('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000032',
 '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000020', 'rechnungsempfaenger', null, null),
('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000033',
 '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000021', 'rechnungsempfaenger',
 null, (now() at time zone 'Europe/Berlin')::date - 1);
insert into public.client_contacts (id, organization_id, client_id, name) values
('38040000-0000-4000-8000-000000000040', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000020', 'Erika Musterfrau'),
('38040000-0000-4000-8000-000000000041', '38040000-0000-4000-8000-000000000010',
 '38040000-0000-4000-8000-000000000021', 'Hans Verwalter'),
('38040000-0000-4000-8000-000000000049', '38040000-0000-4000-8000-000000000011',
 '38040000-0000-4000-8000-000000000029', 'Fremder Kontakt');
-- 50: the customer's job, 51: the Hausverwaltung's, 59: another organization's.
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('38040000-0000-4000-8000-000000000050', '38040000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'B-80', '38040000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38040000-0000-4000-8000-000000000002'),
('38040000-0000-4000-8000-000000000051', '38040000-0000-4000-8000-000000000010', 'Zähler ablesen',
 'B-81', '38040000-0000-4000-8000-000000000021', 'nicht_bearbeitet', '38040000-0000-4000-8000-000000000002'),
('38040000-0000-4000-8000-000000000059', '38040000-0000-4000-8000-000000000011', 'Fremder Auftrag',
 'B-89', '38040000-0000-4000-8000-000000000029', 'nicht_bearbeitet', '38040000-0000-4000-8000-000000000004');

create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal and sqlstate is distinct from p_refusal then
      raise exception '% refused with % (%) instead of %', p_label, sqlerrm, sqlstate, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

-- Grants: the history and every function are server-only; a signed-in role may only select offers.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.offers', 'INSERT')
      or has_table_privilege(v_role, 'public.offers', 'UPDATE')
      or has_table_privilege(v_role, 'public.offers', 'DELETE')
      or has_table_privilege(v_role, 'public.offer_events', 'SELECT')
      or has_table_privilege(v_role, 'public.offer_events', 'INSERT') then
      raise exception '% holds a write or history privilege on offers', v_role;
    end if;
    if has_function_privilege(v_role, 'public.create_offer(uuid,uuid,uuid,text,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.update_offer(uuid,uuid,uuid,integer,uuid,text,uuid,uuid,uuid,date,text,text,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_offer_page(uuid,text,text,uuid,integer,integer)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.get_offer(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.default_billing_recipient(uuid,uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.lock_office_actor(uuid,uuid)', 'EXECUTE') then
      raise exception '% can execute an offer function', v_role;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.offers', 'SELECT') then
    raise exception 'anon can select offers';
  end if;
  if has_table_privilege('service_role', 'public.offer_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.offer_events', 'DELETE')
    or has_table_privilege('service_role', 'public.offers', 'DELETE') then
    raise exception 'service_role can rewrite offers or their history';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.offers'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.offer_events'::regclass) then
    raise exception 'an offer table runs without RLS';
  end if;
end;
$$;

-- The default recipient: the Objekt's current Rechnungsempfänger, else the customer.
do $$
declare
  v_org constant uuid := '38040000-0000-4000-8000-000000000010';
  v_client constant uuid := '38040000-0000-4000-8000-000000000020';
  v_default record;
begin
  v_default := app_private.default_billing_recipient(v_org, v_client, '38040000-0000-4000-8000-000000000030');
  if v_default.recipient_client_id is distinct from '38040000-0000-4000-8000-000000000021'::uuid
    or v_default.source is distinct from 'objekt' then
    raise exception 'an Objekt with a Hausverwaltung as recipient gave %', v_default;
  end if;
  v_default := app_private.default_billing_recipient(v_org, v_client, '38040000-0000-4000-8000-000000000032');
  if v_default.recipient_client_id is distinct from v_client or v_default.source is distinct from 'objekt' then
    raise exception 'an Objekt whose customer holds the role gave %', v_default;
  end if;
  v_default := app_private.default_billing_recipient(v_org, v_client, '38040000-0000-4000-8000-000000000033');
  if v_default.recipient_client_id is distinct from v_client or v_default.source is distinct from 'auftraggeber' then
    raise exception 'an ended role gave %', v_default;
  end if;
  v_default := app_private.default_billing_recipient(v_org, v_client, null);
  if v_default.recipient_client_id is distinct from v_client or v_default.source is distinct from 'auftraggeber' then
    raise exception 'no Objekt gave %', v_default;
  end if;
  v_default := app_private.default_billing_recipient('38040000-0000-4000-8000-000000000011', v_client,
    '38040000-0000-4000-8000-000000000030');
  if v_default.source is distinct from 'auftraggeber' then
    raise exception 'another organization read this organization''s role: %', v_default;
  end if;
end;
$$;

-- The work trigger takes the same rule: the job at the customer's own role records objekt.
insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, status, created_by) values
('38040000-0000-4000-8000-000000000052', '38040000-0000-4000-8000-000000000010', 'Hinterhaus entlüften',
 'B-82', '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000032',
 'nicht_bearbeitet', '38040000-0000-4000-8000-000000000002');
do $$
begin
  if not exists (select 1 from public.work_billing_parties party
    where party.organization_id = '38040000-0000-4000-8000-000000000010'
      and party.job_id = '38040000-0000-4000-8000-000000000052' and party.version = 1
      and party.source = 'objekt' and party.recipient_client_id = '38040000-0000-4000-8000-000000000020') then
    raise exception 'the work default changed for an Objekt whose customer holds the role';
  end if;
end;
$$;

set local role service_role;

-- Create: the next number, the Objekt's recipient, 30 days without a profile, the actor responsible.
select public.create_offer('38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
  '38040000-0000-4000-8000-000000000101', '  Heizungstausch  ', '38040000-0000-4000-8000-000000000020',
  '38040000-0000-4000-8000-000000000030', '38040000-0000-4000-8000-000000000040', 'job',
  '38040000-0000-4000-8000-000000000050');
create temp table ids on commit drop as
select id as first_offer from public.offers
where organization_id = '38040000-0000-4000-8000-000000000010';
grant select on ids to service_role, authenticated;

do $$
declare
  v_offer public.offers;
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
begin
  select * into v_offer from public.offers where id = (select first_offer from ids);
  if v_offer.offer_number is distinct from 'ANG-' || v_year || '-001'
    or v_offer.title is distinct from 'Heizungstausch'
    or v_offer.status is distinct from 'entwurf'
    or v_offer.recipient_client_id is distinct from '38040000-0000-4000-8000-000000000021'::uuid
    or v_offer.recipient_is_default is distinct from true
    or v_offer.valid_until is distinct from (now() at time zone 'Europe/Berlin')::date + 30
    or v_offer.owner_user_id is distinct from '38040000-0000-4000-8000-000000000002'::uuid
    or v_offer.job_id is distinct from '38040000-0000-4000-8000-000000000050'::uuid
    or v_offer.version is distinct from 1 then
    raise exception 'the created offer is %', to_jsonb(v_offer);
  end if;
  if (select count(*) from public.offer_events where organization_id = '38040000-0000-4000-8000-000000000010'
      and offer_id = v_offer.id and event_type = 'created' and status = 'entwurf') is distinct from 1::bigint then
    raise exception 'the create wrote no created event';
  end if;
end;
$$;

-- A retried create under the same key returns the first offer and writes nothing.
do $$
begin
  if public.create_offer('38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
      '38040000-0000-4000-8000-000000000101', 'Heizungstausch', '38040000-0000-4000-8000-000000000020',
      null, null, null, null) is distinct from (select first_offer from ids)
    or (select count(*) from public.offers where organization_id = '38040000-0000-4000-8000-000000000010') is distinct from 1::bigint
    or (select count(*) from public.offer_events where organization_id = '38040000-0000-4000-8000-000000000010') is distinct from 1::bigint then
    raise exception 'a retried create wrote a second offer';
  end if;
end;
$$;

-- Without an Objekt the customer receives the invoice; the company profile sets validity and texts.
reset role;
insert into public.company_document_profiles (organization_id, offer_validity_days, offer_opening_text, offer_closing_text)
values ('38040000-0000-4000-8000-000000000010', 14, 'Vielen Dank für deine Anfrage.', 'Wir freuen uns auf den Auftrag.');
set local role service_role;
do $$
declare
  v_offer_id uuid;
  v_offer public.offers;
begin
  v_offer_id := public.create_offer(
    '38040000-0000-4000-8000-000000000001', '38040000-0000-4000-8000-000000000010',
    '38040000-0000-4000-8000-000000000102', 'Wartung Therme', '38040000-0000-4000-8000-000000000020',
    null, null, null, null);
  select * into v_offer from public.offers where id = v_offer_id;
  if v_offer.offer_number is distinct from 'ANG-' || to_char(timezone('Europe/Berlin', now()), 'YYYY') || '-002'
    or v_offer.recipient_client_id is distinct from '38040000-0000-4000-8000-000000000020'::uuid
    or v_offer.valid_until is distinct from (now() at time zone 'Europe/Berlin')::date + 14
    or v_offer.opening_text is distinct from 'Vielen Dank für deine Anfrage.'
    or v_offer.closing_text is distinct from 'Wir freuen uns auf den Auftrag.' then
    raise exception 'the second offer is %', to_jsonb(v_offer);
  end if;
end;
$$;

-- Refusals write nothing: another organization's customer, Objekt, contact or
-- work, another customer's Objekt or work, an archived customer, and an
-- actor without the office role in the organization.
select pg_temp.expect_refusal(label, format(
  'select public.create_offer(%L, %L, gen_random_uuid(), ''Titel'', %L, %L, %L, %L, %L)',
  actor, org, client, site, contact, work_kind, work_id), refusal)
from (values
  ('foreign customer', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000029', null, null, null, null, 'client_not_found'),
  ('foreign Objekt', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000039', null, null, null, 'site_not_found'),
  ('another customer''s Objekt', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000021', '38040000-0000-4000-8000-000000000030', null, null, null, 'site_not_found'),
  ('foreign contact', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, '38040000-0000-4000-8000-000000000049', null, null, 'contact_not_found'),
  ('another customer''s contact', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, '38040000-0000-4000-8000-000000000041', null, null, 'contact_not_found'),
  ('foreign job', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, null, 'job', '38040000-0000-4000-8000-000000000059', 'work_not_found'),
  ('another customer''s job', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, null, 'job', '38040000-0000-4000-8000-000000000051', 'work_not_found'),
  ('archived customer', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000022', null, null, null, null, 'client_archived'),
  ('employee', '38040000-0000-4000-8000-000000000003', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, null, null, null, 'not_authorized'),
  ('outsider', '38040000-0000-4000-8000-000000000004', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000020', null, null, null, null, 'not_authorized'),
  ('Büro in the foreign organization', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000011',
   '38040000-0000-4000-8000-000000000029', null, null, null, null, 'not_authorized')
) as refused(label, actor, org, client, site, contact, work_kind, work_id, refusal);

do $$
begin
  if (select count(*) from public.offers where organization_id in (
      '38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000011')) is distinct from 2::bigint
    or (select count(*) from public.offer_events where organization_id in (
      '38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000011')) is distinct from 2::bigint then
    raise exception 'a refused create wrote rows';
  end if;
end;
$$;

-- Another organization's offer, and a sent one as a later release writes it.
reset role;
insert into public.offers (id, organization_id, offer_number, title, status, client_id, recipient_client_id, valid_until)
values
('38040000-0000-4000-8000-000000000060', '38040000-0000-4000-8000-000000000011', 'ANG-2037-001',
 'Fremdes Angebot', 'entwurf', '38040000-0000-4000-8000-000000000029', '38040000-0000-4000-8000-000000000029', '2037-12-31'),
('38040000-0000-4000-8000-000000000061', '38040000-0000-4000-8000-000000000010', 'ANG-2037-001',
 'Gesendetes Angebot', 'gesendet', '38040000-0000-4000-8000-000000000021', '38040000-0000-4000-8000-000000000021', '2037-12-31');

-- The header changes (migration 20261230110000_change_the_header_of_a_draft_offer.sql).
-- A savepoint keeps the offers as created for the reads below.
savepoint offer_header;
set local role service_role;
create function pg_temp.save_header(
  p_actor uuid, p_offer uuid, p_version integer, p_key uuid, p_title text, p_site uuid, p_contact uuid,
  p_recipient uuid, p_owner uuid
) returns integer language sql as $$
  select (public.update_offer(p_actor, '38040000-0000-4000-8000-000000000010', p_offer, p_version, p_key,
    p_title, p_site, p_contact, p_recipient, '2037-06-30', 'Hallo', 'Viele Grüße', p_owner) ->> 'version')::integer;
$$;
create function pg_temp.header_events() returns bigint language sql as $$
  select count(*) from public.offer_events
  where organization_id = '38040000-0000-4000-8000-000000000010' and event_type = 'changed';
$$;

-- A save writes the header and its history row with each changed field in
-- one call: the Garage has no Rechnungsempfänger, so the default recipient
-- becomes the customer.
do $$
declare
  v_offer public.offers;
  v_event public.offer_events;
begin
  if pg_temp.save_header('38040000-0000-4000-8000-000000000002', (select first_offer from ids), 1,
      '38040000-0000-4000-8000-000000000201', '  Heizungstausch Altbau  ', '38040000-0000-4000-8000-000000000031',
      '38040000-0000-4000-8000-000000000040', null, '38040000-0000-4000-8000-000000000001') is distinct from 2 then
    raise exception 'the first save did not answer version 2';
  end if;
  select * into v_offer from public.offers where id = (select first_offer from ids);
  if v_offer.title is distinct from 'Heizungstausch Altbau'
    or v_offer.site_id is distinct from '38040000-0000-4000-8000-000000000031'::uuid
    or v_offer.recipient_client_id is distinct from '38040000-0000-4000-8000-000000000020'::uuid
    or v_offer.recipient_is_default is distinct from true
    or v_offer.valid_until is distinct from '2037-06-30'::date
    or v_offer.opening_text is distinct from 'Hallo' or v_offer.closing_text is distinct from 'Viele Grüße'
    or v_offer.owner_user_id is distinct from '38040000-0000-4000-8000-000000000001'::uuid
    or v_offer.client_id is distinct from '38040000-0000-4000-8000-000000000020'::uuid
    or v_offer.job_id is distinct from '38040000-0000-4000-8000-000000000050'::uuid
    or v_offer.updated_by is distinct from '38040000-0000-4000-8000-000000000002'::uuid
    or v_offer.version is distinct from 2 then
    raise exception 'the saved header is %', to_jsonb(v_offer);
  end if;
  select * into v_event from public.offer_events
  where attempt_key = '38040000-0000-4000-8000-000000000201';
  if v_event.event_type is distinct from 'changed' or v_event.version is distinct from 2
    or v_event.status is distinct from 'entwurf'
    or v_event.offer_id is distinct from v_offer.id
    or v_event.actor_id is distinct from '38040000-0000-4000-8000-000000000002'::uuid
    or v_event.payload -> 'title' is distinct from '{"old": "Heizungstausch", "new": "Heizungstausch Altbau"}'::jsonb
    or v_event.payload -> 'recipient_client_id' is distinct from
      '{"old": "38040000-0000-4000-8000-000000000021", "new": "38040000-0000-4000-8000-000000000020"}'::jsonb
    or v_event.payload ? 'recipient_is_default' or v_event.payload ? 'contact_id' then
    raise exception 'the history row of the save is %', to_jsonb(v_event);
  end if;
end;
$$;

-- A retried save under the same key answers its version and writes nothing.
do $$
begin
  if pg_temp.save_header('38040000-0000-4000-8000-000000000002', (select first_offer from ids), 1,
      '38040000-0000-4000-8000-000000000201', 'Heizungstausch Altbau', '38040000-0000-4000-8000-000000000031',
      '38040000-0000-4000-8000-000000000040', null, '38040000-0000-4000-8000-000000000001') is distinct from 2
    or pg_temp.header_events() is distinct from 1::bigint
    or (select version from public.offers where id = (select first_offer from ids)) is distinct from 2 then
    raise exception 'a retried save wrote again';
  end if;
end;
$$;

-- A save from a form filled at an older version is refused and changes nothing.
select pg_temp.expect_refusal('a stale save', format(
  'select pg_temp.save_header(''38040000-0000-4000-8000-000000000002'', %L, 1, gen_random_uuid(), ''Überholt'', null, null, null, ''38040000-0000-4000-8000-000000000002'')',
  (select first_offer from ids)), 'offer_changed');
do $$
begin
  if pg_temp.header_events() is distinct from 1::bigint
    or (select title from public.offers where id = (select first_offer from ids)) is distinct from 'Heizungstausch Altbau' then
    raise exception 'a stale save wrote';
  end if;
end;
$$;

-- A named recipient stays named; a save that changes nothing writes nothing.
do $$
declare
  v_offer public.offers;
begin
  perform pg_temp.save_header('38040000-0000-4000-8000-000000000002', (select first_offer from ids), 2,
    gen_random_uuid(), 'Heizungstausch Altbau', null, null, '38040000-0000-4000-8000-000000000021',
    '38040000-0000-4000-8000-000000000002');
  select * into v_offer from public.offers where id = (select first_offer from ids);
  if v_offer.recipient_client_id is distinct from '38040000-0000-4000-8000-000000000021'::uuid
    or v_offer.recipient_is_default is distinct from false or v_offer.site_id is not null
    or v_offer.contact_id is not null or v_offer.version is distinct from 3 then
    raise exception 'the named recipient saved as %', to_jsonb(v_offer);
  end if;
  if (select payload -> 'contact_id' from public.offer_events
      where offer_id = v_offer.id and event_type = 'changed' and version = 3)
    is distinct from '{"old": "38040000-0000-4000-8000-000000000040", "new": null}'::jsonb then
    raise exception 'the history of the cleared contact is missing';
  end if;
  if pg_temp.save_header('38040000-0000-4000-8000-000000000002', (select first_offer from ids), 3,
      gen_random_uuid(), 'Heizungstausch Altbau', null, null, '38040000-0000-4000-8000-000000000021',
      '38040000-0000-4000-8000-000000000002') is distinct from 3
    or pg_temp.header_events() is distinct from 2::bigint then
    raise exception 'a save without a change wrote';
  end if;
end;
$$;

-- Refusals write nothing: another organization's offer, Objekt, contact or
-- recipient, another customer's contact, an archived recipient, a sent offer,
-- a responsible person outside the office, an actor without the office role
-- in the organization, and a missing title.
select pg_temp.expect_refusal(label, format(
  'select public.update_offer(%L, %L, %L, %s, gen_random_uuid(), %L, %L, %L, %L, ''2037-06-30'', '''', '''', %L)',
  actor, org, offer, version, title, site, contact, recipient, owner), refusal)
from (select first_offer as draft from ids) mine,
  lateral (values
  ('foreign offer', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000060'::uuid, 1, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000002', 'offer_not_found'),
  ('sent offer', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   '38040000-0000-4000-8000-000000000061'::uuid, 1, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000002', 'offer_not_editable'),
  ('foreign Objekt', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', '38040000-0000-4000-8000-000000000039', null, null, '38040000-0000-4000-8000-000000000002', 'site_not_found'),
  ('foreign contact', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, '38040000-0000-4000-8000-000000000049', null, '38040000-0000-4000-8000-000000000002', 'contact_not_found'),
  ('another customer''s contact', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, '38040000-0000-4000-8000-000000000041', null, '38040000-0000-4000-8000-000000000002', 'contact_not_found'),
  ('foreign recipient', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, '38040000-0000-4000-8000-000000000029', '38040000-0000-4000-8000-000000000002', 'recipient_not_found'),
  ('archived recipient', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, '38040000-0000-4000-8000-000000000022', '38040000-0000-4000-8000-000000000002', 'recipient_archived'),
  ('employee responsible', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000003', 'owner_not_found'),
  ('outsider responsible', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000004', 'owner_not_found'),
  ('employee', '38040000-0000-4000-8000-000000000003', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000002', 'not_authorized'),
  ('outsider', '38040000-0000-4000-8000-000000000004', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000002', 'not_authorized'),
  ('Büro in the foreign organization', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000011',
   '38040000-0000-4000-8000-000000000060'::uuid, 1, 'Titel', null, null, null, '38040000-0000-4000-8000-000000000002', 'not_authorized'),
  ('blank title', '38040000-0000-4000-8000-000000000002', '38040000-0000-4000-8000-000000000010',
   mine.draft, 3, '   ', null, null, null, '38040000-0000-4000-8000-000000000002', 'invalid_input')
) as refused(label, actor, org, offer, version, title, site, contact, recipient, owner, refusal);
do $$
begin
  if pg_temp.header_events() is distinct from 2::bigint
    or (select version from public.offers where id = (select first_offer from ids)) is distinct from 3
    or (select title from public.offers where id = '38040000-0000-4000-8000-000000000060') is distinct from 'Fremdes Angebot' then
    raise exception 'a refused save wrote';
  end if;
end;
$$;

-- A kept recipient that was archived and a kept responsible person who left
-- the office do not stop an unrelated change.
reset role;
update public.clients set archived_at = now() where id = '38040000-0000-4000-8000-000000000021';
update public.organization_members set role = 'employee'
where organization_id = '38040000-0000-4000-8000-000000000010' and user_id = '38040000-0000-4000-8000-000000000002';
set local role service_role;
do $$
begin
  if pg_temp.save_header('38040000-0000-4000-8000-000000000001', (select first_offer from ids), 3,
      gen_random_uuid(), 'Heizungstausch Neubau', null, null, '38040000-0000-4000-8000-000000000021',
      '38040000-0000-4000-8000-000000000002') is distinct from 4 then
    raise exception 'a kept archived recipient or former office member stopped the save';
  end if;
end;
$$;
rollback to savepoint offer_header;

-- The history is append-only, also for a privileged role.
select pg_temp.expect_refusal('rewriting an offer event',
  $sql$update public.offer_events set payload = '{}' where organization_id = '38040000-0000-4000-8000-000000000010'$sql$,
  'event_ledger_history_immutable');
select pg_temp.expect_refusal('deleting an offer event',
  $sql$delete from public.offer_events where organization_id = '38040000-0000-4000-8000-000000000010'$sql$,
  'event_ledger_history_immutable');

-- The list finds by number, title and customer, filters by status and customer, and pages.
set local role service_role;
do $$
declare
  v_org constant uuid := '38040000-0000-4000-8000-000000000010';
  v_page jsonb;
begin
  v_page := public.list_offer_page(v_org, null, '', null, 1, 2);
  if (v_page ->> 'total')::integer is distinct from 3 or jsonb_array_length(v_page -> 'rows') is distinct from 2 then
    raise exception 'the first page is %', v_page;
  end if;
  v_page := public.list_offer_page(v_org, null, 'lindenhof', null, 1, 50);
  if (v_page ->> 'total')::integer is distinct from 1 then
    raise exception 'the customer search found %', v_page;
  end if;
  v_page := public.list_offer_page(v_org, 'entwurf', '-002', null, 1, 50);
  if (v_page ->> 'total')::integer is distinct from 1 or (v_page -> 'rows' -> 0 ->> 'title') is distinct from 'Wartung Therme' then
    raise exception 'the number search in Entwurf found %', v_page;
  end if;
  v_page := public.list_offer_page(v_org, null, '', '38040000-0000-4000-8000-000000000020', 1, 50);
  if (v_page ->> 'total')::integer is distinct from 2
    or not (v_page -> 'rows') @> '[{"title": "Heizungstausch", "recipientName": "Hausverwaltung Lindenhof GmbH"}]'
    or not (v_page -> 'rows') @> '[{"title": "Wartung Therme", "recipientName": null}]' then
    raise exception 'the customer''s offers are %', v_page;
  end if;
  if public.get_offer(v_org, '38040000-0000-4000-8000-000000000060') is not null
    or (public.list_offer_page('38040000-0000-4000-8000-000000000011', null, '', null, 1, 50) ->> 'total')::integer is distinct from 1 then
    raise exception 'an organization read another organization''s offer';
  end if;
  if (public.get_offer(v_org, (select first_offer from ids)) -> 'work' ->> 'number') is distinct from 'B-80'
    or (public.get_offer(v_org, (select first_offer from ids)) -> 'owner' ->> 'firstName') is distinct from 'Max' then
    raise exception 'the offer reads %', public.get_offer(v_org, (select first_offer from ids));
  end if;
end;
$$;
reset role;

-- A signed-in session: the office reads its organization's offers to hear of
-- a change; an employee and another organization read none, and nobody reads the history.
create function pg_temp.offers_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.offers where organization_id = '38040000-0000-4000-8000-000000000010';
  perform pg_temp.expect_refusal('history read', 'select count(*) from public.offer_events', '42501');
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.offers_seen_by('38040000-0000-4000-8000-000000000002') is distinct from 3::bigint
    or pg_temp.offers_seen_by('38040000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.offers_seen_by('38040000-0000-4000-8000-000000000004') is distinct from 0::bigint then
    raise exception 'an offer read crossed a role or an organization';
  end if;
end;
$$;

-- A customer an offer names stays: as Auftraggeber and as Rechnungsempfänger.
do $$
begin
  if (app_private.client_links('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000021') ->> 'offers')
      is distinct from '2'
    or (app_private.client_links('38040000-0000-4000-8000-000000000010', '38040000-0000-4000-8000-000000000020') ->> 'offers')
      is distinct from '2' then
    raise exception 'an offer does not keep its customers from deletion';
  end if;
end;
$$;

-- The number grows past 999 and starts again each year.
insert into public.offers (organization_id, offer_number, title, client_id, recipient_client_id, valid_until)
values ('38040000-0000-4000-8000-000000000010', 'ANG-' || to_char(timezone('Europe/Berlin', now()), 'YYYY') || '-999',
  'Viele Angebote', '38040000-0000-4000-8000-000000000020', '38040000-0000-4000-8000-000000000020', '2037-12-31');
do $$
begin
  if app_private.next_offer_number('38040000-0000-4000-8000-000000000010')
      is distinct from 'ANG-' || to_char(timezone('Europe/Berlin', now()), 'YYYY') || '-1000' then
    raise exception 'the number after 999 is wrong';
  end if;
end;
$$;

-- Deleting an organization removes its offers with their history.
delete from public.organizations where id = '38040000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.offers where organization_id = '38040000-0000-4000-8000-000000000010')
    or exists (select 1 from public.offer_events where organization_id = '38040000-0000-4000-8000-000000000010') then
    raise exception 'organization cascade left offer rows';
  end if;
end;
$$;

rollback;
