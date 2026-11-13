-- Work keeps its Auftraggeber and its frozen Rechnungsempfänger: defaults
-- from the Objekt's payer role, a copy that survives a customer edit, the
-- office's choice with history, the carry on conversion and the organization
-- boundary (migration 20261202090001_keep_work_auftraggeber_and_frozen_recipient.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('32700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Rechnung"}', now(), now()),
('32700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Rechnung"}', now(), now()),
('32700000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Rechnung"}', now(), now()),
('32700000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Rechnung"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('32700000-0000-0000-0000-000000000010', 'Billing SQL', '32700000-0000-0000-0000-000000000001', 'BILLSQL'),
('32700000-0000-0000-0000-000000000011', 'Billing SQL other', '32700000-0000-0000-0000-000000000004', 'BILLSQLO');
insert into public.organization_members (organization_id, user_id, role) values
('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000002', 'buero'),
('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000003', 'employee');

-- 20: the WEG the Objekt is filed under; 21: the Hausverwaltung that pays;
-- 22: another Hausverwaltung; 23: an archived customer; 29: a customer of
-- the other organization; 24: a customer that only pays.
insert into public.clients (id, organization_id, name, client_type, address) values
('32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'Lindenstraße 5, 10115 Berlin'),
('32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin'),
('32700000-0000-0000-0000-000000000022', '32700000-0000-0000-0000-000000000010',
 'Hausverwaltung Birkenhain GmbH', 'gewerblich', 'Birkenweg 2, 20095 Hamburg'),
('32700000-0000-0000-0000-000000000023', '32700000-0000-0000-0000-000000000010',
 'Archivierte Verwaltung', 'gewerblich', null),
('32700000-0000-0000-0000-000000000024', '32700000-0000-0000-0000-000000000010',
 'Erika Musterfrau', 'privat', 'Musterweg 3, 10117 Berlin'),
('32700000-0000-0000-0000-000000000029', '32700000-0000-0000-0000-000000000011',
 'Fremde Verwaltung', 'gewerblich', null);
update public.clients set archived_at = now() where id = '32700000-0000-0000-0000-000000000023';
-- 40: the WEG's Objekt with a payer role; 41: a second Objekt without one;
-- 49: the other organization's.
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('32700000-0000-0000-0000-000000000040', '32700000-0000-0000-0000-000000000010',
 '32700000-0000-0000-0000-000000000020', 'Haus Lindenstraße', 'Lindenstraße 5', '10115', 'Berlin'),
('32700000-0000-0000-0000-000000000041', '32700000-0000-0000-0000-000000000010',
 '32700000-0000-0000-0000-000000000020', 'Garagenhof', 'Lindenstraße 7', '10115', 'Berlin'),
('32700000-0000-0000-0000-000000000049', '32700000-0000-0000-0000-000000000011',
 '32700000-0000-0000-0000-000000000029', 'Fremdes Haus', 'Fremdweg 1', '10115', 'Berlin');
insert into public.client_site_roles (organization_id, site_id, client_id, holder_client_id, role, starts_on) values
('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000040',
 '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000021', 'rechnungsempfaenger', null);
insert into public.client_contacts (id, organization_id, client_id, name, phone, site_id, site_role) values
('32700000-0000-0000-0000-000000000030', '32700000-0000-0000-0000-000000000010',
 '32700000-0000-0000-0000-000000000020', 'Max Hausmeister', '+49 30 1234567',
 '32700000-0000-0000-0000-000000000040', 'zugangskontakt');

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Browser roles reach neither the rows nor the functions: a field worker
-- never reads the recipient.
do $$
begin
  if has_table_privilege('anon', 'public.work_billing_parties', 'SELECT')
    or has_table_privilege('authenticated', 'public.work_billing_parties', 'SELECT')
    or has_table_privilege('authenticated', 'public.work_billing_parties', 'INSERT')
    or has_table_privilege('service_role', 'public.work_billing_parties', 'UPDATE')
    or has_table_privilege('service_role', 'public.work_billing_parties', 'DELETE')
  then raise exception 'a role reads the parties outside the server or changes a version'; end if;
  if has_function_privilege('authenticated', 'public.set_work_billing_parties(uuid,uuid,text,uuid,uuid,uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.get_work_billing_parties(uuid,text,uuid)', 'EXECUTE')
  then raise exception 'a browser role can run a billing parties function'; end if;
end;
$$;

-- Work: 50 at the Objekt with the payer role, 51 at the Objekt without, 52
-- without a site, 59 of the other organization. A request 60 without a
-- customer, 61 at the Objekt, 62 closed.
insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, status, created_by) values
('32700000-0000-0000-0000-000000000050', '32700000-0000-0000-0000-000000000010', 'Heizung entlüften',
 'B-50', '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000040',
 'nicht_bearbeitet', '32700000-0000-0000-0000-000000000001'),
('32700000-0000-0000-0000-000000000051', '32700000-0000-0000-0000-000000000010', 'Tor schmieren',
 'B-51', '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000041',
 'nicht_bearbeitet', '32700000-0000-0000-0000-000000000001'),
('32700000-0000-0000-0000-000000000052', '32700000-0000-0000-0000-000000000010', 'Beratung',
 'B-52', '32700000-0000-0000-0000-000000000020', null,
 'nicht_bearbeitet', '32700000-0000-0000-0000-000000000001'),
('32700000-0000-0000-0000-000000000059', '32700000-0000-0000-0000-000000000011', 'Fremde Arbeit',
 'B-59', '32700000-0000-0000-0000-000000000029', '32700000-0000-0000-0000-000000000049',
 'nicht_bearbeitet', '32700000-0000-0000-0000-000000000004');
insert into public.client_requests (id, organization_id, summary, client_id, site_id, caller_name, status,
  closed_reason, closed_at) values
('32700000-0000-0000-0000-000000000060', '32700000-0000-0000-0000-000000000010', 'Unbekannter Anruf',
 null, null, 'Erika Musterfrau', 'offen', null, null),
('32700000-0000-0000-0000-000000000061', '32700000-0000-0000-0000-000000000010', 'Heizung kalt',
 '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000040', null, 'offen', null, null),
('32700000-0000-0000-0000-000000000062', '32700000-0000-0000-0000-000000000010', 'Erledigt',
 '32700000-0000-0000-0000-000000000020', null, null, 'geschlossen', 'kein_bedarf', now());

set local role service_role;

-- Defaults: the Auftraggeber is the work's customer; the recipient is the
-- Objekt's current Rechnungsempfänger with its name and address copied, else
-- the Auftraggeber. A request without a customer has none yet.
do $$
declare
  v_party public.work_billing_parties;
begin
  v_party := app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050');
  if v_party.version is distinct from 1 or v_party.source is distinct from 'objekt'
    or v_party.client_id is distinct from '32700000-0000-0000-0000-000000000020'
    or v_party.recipient_client_id is distinct from '32700000-0000-0000-0000-000000000021'
    or v_party.recipient_name is distinct from 'Hausverwaltung Lindenhof GmbH'
    or v_party.recipient_address is distinct from 'Hofweg 1, 10117 Berlin'
    or v_party.set_by is not null
  then raise exception 'the Objekt''s payer did not become the recipient of job 50: %', to_jsonb(v_party); end if;
  v_party := app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000051');
  if v_party.source is distinct from 'auftraggeber' or v_party.recipient_client_id is distinct from '32700000-0000-0000-0000-000000000020'
    or v_party.recipient_name is distinct from 'WEG Lindenstraße 5'
  then raise exception 'without a payer role the Auftraggeber did not become the recipient'; end if;
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000052')).source is distinct from 'auftraggeber'
  then raise exception 'work without a site has no default parties'; end if;
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000061')).recipient_client_id
    is distinct from '32700000-0000-0000-0000-000000000021'
  then raise exception 'a request at the Objekt did not take its payer'; end if;
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000060')).id is not null
  then raise exception 'a request without a customer has parties'; end if;
end;
$$;

-- The copy survives a customer edit.
update public.clients set name = 'Lindenhof Immobilien GmbH', address = 'Neuer Weg 9, 10119 Berlin'
where id = '32700000-0000-0000-0000-000000000021';
do $$
declare
  v_party public.work_billing_parties :=
    app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050');
begin
  if v_party.version is distinct from 1 or v_party.recipient_name is distinct from 'Hausverwaltung Lindenhof GmbH'
    or v_party.recipient_address is distinct from 'Hofweg 1, 10117 Berlin'
  then raise exception 'a customer edit rewrote the frozen recipient: %', to_jsonb(v_party); end if;
end;
$$;

-- The organization boundary and the manager role.
select pg_temp.expect_refusal('another organization''s customer as recipient',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000029',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'recipient_not_found');
select pg_temp.expect_refusal('another organization''s customer as Auftraggeber',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000029', '32700000-0000-0000-0000-000000000021',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'client_not_found');
select pg_temp.expect_refusal('another organization''s work',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000059',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000021',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000059')).version, 0))$sql$,
  'work_not_found');
select pg_temp.expect_refusal('a job id passed as a Servicefall',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'service_case', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000021',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'work_not_found');
select pg_temp.expect_refusal('a field worker choosing the recipient',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000003',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'not_authorized');
select pg_temp.expect_refusal('an outsider choosing the recipient',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000004',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'not_authorized');
select pg_temp.expect_refusal('an archived customer as new recipient',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000023',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0))$sql$,
  'client_archived');
select pg_temp.expect_refusal('a closed request',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'request', '32700000-0000-0000-0000-000000000062',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000062')).version, 0))$sql$,
  'request_not_editable');
select pg_temp.expect_refusal('a request without a customer',
  $sql$select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'request', '32700000-0000-0000-0000-000000000060',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000060')).version, 0))$sql$,
  'client_required');
do $$
begin
  if (select count(*) from public.work_billing_parties
    where work_id = '32700000-0000-0000-0000-000000000050') is distinct from 1
  then raise exception 'a refused choice wrote a version'; end if;
end;
$$;

-- The office chooses: a new version with the actor; the old one stays as
-- history. Saving the same choice writes nothing until the recipient's data
-- changed, then copies the new data.
do $$
declare
  v_party public.work_billing_parties;
begin
  v_party := public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0));
  if v_party.version is distinct from 2 or v_party.source is distinct from 'buero'
    or v_party.client_id is distinct from '32700000-0000-0000-0000-000000000021'
    or v_party.recipient_name is distinct from 'Hausverwaltung Birkenhain GmbH'
    or v_party.set_by is distinct from '32700000-0000-0000-0000-000000000002'
  then raise exception 'the office''s choice was not recorded: %', to_jsonb(v_party); end if;

  v_party := public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0));
  if v_party.version is distinct from 2 then raise exception 'an unchanged choice wrote a version'; end if;

  update public.clients set address = 'Birkenallee 4, 20095 Hamburg'
  where id = '32700000-0000-0000-0000-000000000022';
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).recipient_address
    is distinct from 'Birkenweg 2, 20095 Hamburg'
  then raise exception 'a customer edit rewrote the chosen recipient'; end if;
  v_party := public.set_work_billing_parties('32700000-0000-0000-0000-000000000001',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000050',
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version, 0));
  if v_party.version is distinct from 3 or v_party.recipient_address is distinct from 'Birkenallee 4, 20095 Hamburg'
  then raise exception 'choosing the recipient again did not copy its new address'; end if;
  if (select array_agg(version order by version) from public.work_billing_parties
    where work_id = '32700000-0000-0000-0000-000000000050') is distinct from array[1, 2, 3]
  then raise exception 'the history of job 50 is not kept'; end if;
end;
$$;

-- Confirming the default pair is a choice: it is recorded once, as the
-- office's, so a later site change keeps it.
do $$
declare
  v_party public.work_billing_parties;
begin
  v_party := public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000052',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000020',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000052')).version, 0));
  if v_party.version is distinct from 2 or v_party.source is distinct from 'buero'
  then raise exception 'confirming the default pair was not recorded as the office''s choice: %', to_jsonb(v_party); end if;
  v_party := public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000052',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000020',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000052')).version, 0));
  if v_party.version is distinct from 2 then raise exception 'confirming the chosen pair again wrote a version'; end if;
  update public.jobs set site_id = '32700000-0000-0000-0000-000000000040'
  where id = '32700000-0000-0000-0000-000000000052';
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000052')).source is distinct from 'buero'
  then raise exception 'a changed site replaced a confirmed default'; end if;
end;
$$;

-- A changed site keeps a chosen recipient and derives defaults again; a
-- changed customer always derives them again.
do $$
begin
  update public.jobs set site_id = '32700000-0000-0000-0000-000000000041'
  where id = '32700000-0000-0000-0000-000000000050';
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).version is distinct from 3
  then raise exception 'a changed site replaced the office''s choice'; end if;

  update public.jobs set site_id = '32700000-0000-0000-0000-000000000040'
  where id = '32700000-0000-0000-0000-000000000051';
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000051')).recipient_client_id
    is distinct from '32700000-0000-0000-0000-000000000021'
  then raise exception 'a default recipient did not follow the new Objekt''s payer'; end if;

  update public.jobs set client_id = '32700000-0000-0000-0000-000000000022', site_id = null
  where id = '32700000-0000-0000-0000-000000000050';
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000050')).recipient_client_id
    is distinct from '32700000-0000-0000-0000-000000000022'
  then raise exception 'a changed customer kept the old parties'; end if;
end;
$$;

-- A conversion carries the request's chosen parties with their copy; a
-- Servicefall from the request carries them too; a job of a project takes
-- the project's chosen parties.
do $$
declare
  v_party public.work_billing_parties;
begin
  perform public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'request', '32700000-0000-0000-0000-000000000061',
    '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000061')).version, 0));
  update public.clients set name = 'Birkenhain Verwaltung'
  where id = '32700000-0000-0000-0000-000000000022';

  insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, status, created_by) values
  ('32700000-0000-0000-0000-000000000053', '32700000-0000-0000-0000-000000000010', 'Aus Anfrage',
   'B-53', '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000040',
   'nicht_bearbeitet', '32700000-0000-0000-0000-000000000002');
  update public.client_requests set status = 'umgewandelt',
    converted_job_id = '32700000-0000-0000-0000-000000000053',
    converted_by = '32700000-0000-0000-0000-000000000002', converted_at = now()
  where id = '32700000-0000-0000-0000-000000000061';
  v_party := app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000053');
  if v_party.source is distinct from 'anfrage' or v_party.recipient_client_id is distinct from '32700000-0000-0000-0000-000000000022'
    or v_party.recipient_name is distinct from 'Hausverwaltung Birkenhain GmbH'
    or v_party.set_by is distinct from '32700000-0000-0000-0000-000000000002'
  then raise exception 'the conversion did not carry the request''s frozen recipient: %', to_jsonb(v_party); end if;

  perform set_config('app.service_case_write', 'true', true);
  insert into public.service_cases (
    id, organization_id, case_number, intake_type, source_request_id, client_id, site_id,
    original_statement, summary, status, created_by, updated_by
  ) values (
    '32700000-0000-0000-0000-000000000070', '32700000-0000-0000-0000-000000000010', 'S-70', 'request',
    '32700000-0000-0000-0000-000000000061', '32700000-0000-0000-0000-000000000020',
    '32700000-0000-0000-0000-000000000040', 'Heizung kalt', 'Heizung kalt', 'new',
    '32700000-0000-0000-0000-000000000002', '32700000-0000-0000-0000-000000000002'
  );
  perform set_config('app.service_case_write', 'false', true);
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000070')).source is distinct from 'anfrage'
  then raise exception 'a Servicefall from the request did not carry its parties'; end if;

  insert into public.projects (id, organization_id, name, project_number, client_id, site_id, created_by) values
  ('32700000-0000-0000-0000-000000000080', '32700000-0000-0000-0000-000000000010', 'Strangsanierung',
   'P-80', '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000040',
   '32700000-0000-0000-0000-000000000001');
  perform public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'project', '32700000-0000-0000-0000-000000000080',
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000020',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000080')).version, 0));
  insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, project_id, status, created_by)
  values ('32700000-0000-0000-0000-000000000054', '32700000-0000-0000-0000-000000000010', 'Strang 1',
   'B-54', '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000040',
   '32700000-0000-0000-0000-000000000080', 'nicht_bearbeitet', '32700000-0000-0000-0000-000000000001');
  v_party := app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000054');
  if v_party.source is distinct from 'projekt' or v_party.client_id is distinct from '32700000-0000-0000-0000-000000000021'
    or v_party.recipient_client_id is distinct from '32700000-0000-0000-0000-000000000020'
  then raise exception 'a job of the project did not take the project''s parties'; end if;
end;
$$;

-- The office's read: every version, the Einsatzort and its access contacts;
-- nothing for another organization's work.
do $$
declare
  v_read jsonb := public.get_work_billing_parties('32700000-0000-0000-0000-000000000010', 'job',
    '32700000-0000-0000-0000-000000000051');
begin
  if jsonb_array_length(v_read -> 'versions') is distinct from 2
    or v_read -> 'versions' -> 0 -> 'recipient' ->> 'name' is distinct from 'Lindenhof Immobilien GmbH'
    or v_read -> 'site' ->> 'name' is distinct from 'Haus Lindenstraße'
    or v_read -> 'accessContacts' -> 0 ->> 'name' is distinct from 'Max Hausmeister'
  then raise exception 'the office read is incomplete: %', v_read; end if;
  if public.get_work_billing_parties('32700000-0000-0000-0000-000000000010', 'job',
    '32700000-0000-0000-0000-000000000059') is not null
  then raise exception 'the office read crossed the organization boundary'; end if;
end;
$$;

-- A version never changes or leaves on its own: security_boundaries.sql
-- asserts the ledger's denials and its permitted cleanup.
select public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
  '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000052',
  '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000024',
    coalesce((app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000052')).version, 0));
reset role;

-- Two office users saved from the same version: the second save is refused
-- with parties_changed and appends nothing, so it never writes back the
-- Auftraggeber the first one replaced.
do $$
declare
  v_seen integer := (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000054')).version;
  v_versions integer;
begin
  perform public.set_work_billing_parties('32700000-0000-0000-0000-000000000002',
    '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000054',
    '32700000-0000-0000-0000-000000000022', '32700000-0000-0000-0000-000000000021', v_seen);
  select count(*) into v_versions from public.work_billing_parties
  where work_id = '32700000-0000-0000-0000-000000000054';
  begin
    perform public.set_work_billing_parties('32700000-0000-0000-0000-000000000001',
      '32700000-0000-0000-0000-000000000010', 'job', '32700000-0000-0000-0000-000000000054',
      '32700000-0000-0000-0000-000000000020', '32700000-0000-0000-0000-000000000022', v_seen);
    raise exception 'a save from an outdated version was accepted';
  exception when raise_exception then
    if sqlerrm is distinct from 'parties_changed' then raise; end if;
  end;
  if (select count(*) from public.work_billing_parties
      where work_id = '32700000-0000-0000-0000-000000000054') is distinct from v_versions
    or (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010', '32700000-0000-0000-0000-000000000054')).client_id
      is distinct from '32700000-0000-0000-0000-000000000022'
  then raise exception 'a refused stale save changed the parties'; end if;
end;
$$;

-- The current version is read inside one organization: another
-- organization's work id finds nothing, its own organization finds it.
do $$
begin
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000010',
      '32700000-0000-0000-0000-000000000059')).id is not null
  then raise exception 'the current version crossed the organization boundary'; end if;
  if (app_private.current_work_billing_parties('32700000-0000-0000-0000-000000000011',
      '32700000-0000-0000-0000-000000000059')).id is null
  then raise exception 'the other organization''s own work lost its current version'; end if;
end;
$$;

-- A version always belongs to its work's organization, for every kind of work.
do $$
declare
  v_kind text;
begin
  foreach v_kind in array array['job_id', 'request_id', 'project_id', 'service_case_id'] loop
    begin
      execute format(
        'insert into public.work_billing_parties (organization_id, %I, work_id, version, client_id,
           recipient_client_id, recipient_name, source) values ($1, $2, $2, 99, $3, $3, $4, ''buero'')', v_kind)
      using '32700000-0000-0000-0000-000000000011'::uuid,
        case v_kind
          when 'job_id' then '32700000-0000-0000-0000-000000000051'::uuid
          when 'request_id' then '32700000-0000-0000-0000-000000000060'::uuid
          when 'project_id' then '32700000-0000-0000-0000-000000000080'::uuid
          else '32700000-0000-0000-0000-000000000070'::uuid end,
        '32700000-0000-0000-0000-000000000029'::uuid, 'Fremde Verwaltung';
    exception when foreign_key_violation then
      continue;
    end;
    raise exception 'a version of another organization was attached to its % work', v_kind;
  end loop;
end;
$$;

-- A customer that is only the recipient of another customer's work is
-- linked and stays; deleting the work removes its parties with it.
do $$
begin
  if app_private.client_links('32700000-0000-0000-0000-000000000010',
    '32700000-0000-0000-0000-000000000024') is distinct from '{"billing_parties": 1}'::jsonb
  then raise exception 'the recipient of another customer''s work is not linked'; end if;
  begin
    delete from public.clients where id = '32700000-0000-0000-0000-000000000024';
    raise exception 'a recipient of other work was deleted';
  exception when raise_exception then
    if sqlerrm is distinct from 'client_has_history' then raise; end if;
  end;
  delete from public.jobs where id = '32700000-0000-0000-0000-000000000052';
  if exists (select 1 from public.work_billing_parties where work_id = '32700000-0000-0000-0000-000000000052')
  then raise exception 'a deleted job left its parties'; end if;
  if app_private.client_links('32700000-0000-0000-0000-000000000010',
    '32700000-0000-0000-0000-000000000024') is distinct from '{}'::jsonb
  then raise exception 'a deleted job still links its recipient'; end if;
end;
$$;

rollback;
