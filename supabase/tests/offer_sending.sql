-- The office records an offer as sent, and every sent revision stays as it was
-- (migration 20270601090000_send_an_offer_and_keep_each_sent_revision.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'send-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38070000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'send-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38070000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'send-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38070000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'send-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38070000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Versand', '38070000-0000-4000-8000-000000000001', 'OFFSEND'),
('38070000-0000-4000-8000-000000000011', 'Fremde Haustechnik Versand', '38070000-0000-4000-8000-000000000004', 'OFFSENO');
insert into public.organization_members (organization_id, user_id, role) values
('38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000002', 'buero'),
('38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, client_type, address) values
('38070000-0000-4000-8000-000000000020', '38070000-0000-4000-8000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'Lindenstraße 5, 10115 Berlin'),
('38070000-0000-4000-8000-000000000029', '38070000-0000-4000-8000-000000000011',
 'Fremde Kundin', 'privat', 'Weg 1, 10115 Berlin');
-- The employee works on a job of the offer's customer.
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('38070000-0000-4000-8000-000000000050', '38070000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'B-70', '38070000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38070000-0000-4000-8000-000000000002');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000050',
 '38070000-0000-4000-8000-000000000003', '38070000-0000-4000-8000-000000000002');

-- An upload in the library root already carries the name the sent PDF asks for.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by
) values
('38070000-0000-4000-8000-000000000310', '38070000-0000-4000-8000-000000000010',
 '38070000-0000-4000-8000-000000000010/38070000-0000-4000-8000-000000000310/Angebot.pdf', 'Angebot.pdf',
 'Angebot.pdf', 'offer', 10, '38070000-0000-4000-8000-000000000002');

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

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from ids where name = p_name;
$$;
grant execute on function pg_temp.id(text) to service_role, authenticated;

-- A Leistung of the organization (20270501090000).
insert into public.leistungen (id, organization_id, leistung_number, name, kind, unit, tax_rate_basis_points)
values ('38070000-0000-4000-8000-000000000060', '38070000-0000-4000-8000-000000000010', 'L-1',
  'Wartung Gastherme', 'pauschale', 'flat_rate', 1900);

-- One Titel with a typed Position, a text line and a Position from the
-- Leistung, both priced ones with the office's cost: 2 × 100,00 € and
-- 1 × 129,00 € at 19 %.
create function pg_temp.content() returns jsonb language sql as $$
  select '[{"title": "Heizung", "netCents": 32900, "positions": [
    {"kind": "free", "name": "Monteurstunde", "description": "", "quantity": "2", "unit": "hour",
     "unitLabel": "Std.", "unitPriceCents": 10000, "priceQuantity": 1, "taxRateBasisPoints": 1900,
     "amountCents": 20000, "purchaseCost": {"amountCents": 6000, "priceQuantity": 1}},
    {"kind": "text", "name": "Hinweis", "description": "Nach Absprache mit der Hausverwaltung."},
    {"kind": "free", "name": "Wartung Gastherme", "description": "", "quantity": "1", "unit": "flat_rate",
     "unitLabel": "psch", "unitPriceCents": 12900, "priceQuantity": 1, "taxRateBasisPoints": 1900,
     "amountCents": 12900, "source": {"kind": "leistung", "id": "38070000-0000-4000-8000-000000000060"},
     "purchaseCost": {"amountCents": 8000, "priceQuantity": 1}}]}]'::jsonb;
$$;
grant execute on function pg_temp.content() to service_role;

-- A send of offer p_offer as Büro from the versions named, with a stored document p_document.
create function pg_temp.send(
  p_offer uuid, p_version integer, p_content_version integer, p_key uuid, p_document uuid,
  p_actor uuid default '38070000-0000-4000-8000-000000000002',
  p_organization uuid default '38070000-0000-4000-8000-000000000010'
) returns jsonb language sql as $$
  select public.send_offer(p_actor, p_organization, p_offer, p_version, p_content_version, p_key, 'post',
    (now() at time zone 'Europe/Berlin')::date, 'WEG Lindenstraße 5', 'Lindenstraße 5, 10115 Berlin',
    '{"organizationName": "Haustechnik Sonnenberg Versand", "profile": {}, "files": {}, "site": null}',
    p_document, p_organization::text || '/' || p_document::text || '/Angebot.pdf', 'Angebot.pdf', 2048,
    repeat('a', 64));
$$;
grant execute on function pg_temp.send(uuid, integer, integer, uuid, uuid, uuid, uuid) to service_role;

set local role service_role;
insert into ids
select 'first', public.create_offer('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  gen_random_uuid(), 'Heizungstausch', '38070000-0000-4000-8000-000000000020', null, null, null, null)
union all
select 'second', public.create_offer('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  gen_random_uuid(), 'Wartung', '38070000-0000-4000-8000-000000000020', null, null, null, null)
union all
select 'empty', public.create_offer('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  gen_random_uuid(), 'Ohne Positionen', '38070000-0000-4000-8000-000000000020', null, null, null, null);
select public.save_offer_content('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  pg_temp.id(name), 1, gen_random_uuid(), pg_temp.content(),
  '{"netCents": 32900, "taxCents": 6251, "grossCents": 39151}')
from ids where name in ('first', 'second');

-- Sending freezes revision 1: the content with its amounts and sources and
-- without the costs the draft holds, the Leistung's Position numbered like any
-- priced one, the recipient as
-- rendered, the PDF as a filed offer document of the ten-year class linked to
-- the offer and its customer only, „Gesendet“, and the history with the channel.
do $$
declare
  v_answer jsonb := pg_temp.send(pg_temp.id('first'), 1, 2, '38070000-0000-4000-8000-000000000101',
    '38070000-0000-4000-8000-000000000301');
  v_revision public.offer_revisions;
  v_document public.documents;
  v_event public.offer_events;
begin
  if v_answer is distinct from '{"revision": 1, "documentId": "38070000-0000-4000-8000-000000000301",
      "replay": false}'::jsonb then
    raise exception 'the send answered %', v_answer;
  end if;
  select * into v_revision from public.offer_revisions
  where organization_id = '38070000-0000-4000-8000-000000000010' and offer_id = pg_temp.id('first');
  if v_revision.revision is distinct from 1 or v_revision.channel is distinct from 'post'
    or v_revision.recipient_name is distinct from 'WEG Lindenstraße 5'
    or v_revision.recipient_address is distinct from 'Lindenstraße 5, 10115 Berlin'
    or v_revision.gross_cents is distinct from 39151::bigint
    or v_revision.sent_by is distinct from '38070000-0000-4000-8000-000000000002'::uuid
    or v_revision.document_id is distinct from '38070000-0000-4000-8000-000000000301'::uuid
    or v_revision.content #> '{0,positions,0}' is distinct from '{"number": "1.1", "kind": "free",
      "name": "Monteurstunde", "description": "", "quantity": "2.000", "unit": "hour", "unitLabel": "Std.",
      "unitPriceCents": 10000, "priceQuantity": 1, "taxRateBasisPoints": 1900, "amountCents": 20000}'::jsonb
    or v_revision.content #> '{0,positions,1}' is distinct from '{"kind": "text", "name": "Hinweis",
      "description": "Nach Absprache mit der Hausverwaltung."}'::jsonb
    or v_revision.content #> '{0,positions,2}' is distinct from '{"number": "1.2", "kind": "free",
      "name": "Wartung Gastherme", "description": "", "quantity": "1.000", "unit": "flat_rate",
      "unitLabel": "psch", "unitPriceCents": 12900, "priceQuantity": 1, "taxRateBasisPoints": 1900,
      "amountCents": 12900, "leistungId": "38070000-0000-4000-8000-000000000060"}'::jsonb
    -- The draft held both costs; no field of the frozen revision names one.
    or (select count(*) from public.offer_positions line
        where line.organization_id = '38070000-0000-4000-8000-000000000010'
          and line.offer_id = pg_temp.id('first') and line.purchase_cost_cents is not null) <> 2
    or to_jsonb(v_revision)::text ~* 'cost|margin' then
    raise exception 'the sent revision is %', to_jsonb(v_revision);
  end if;
  select * into v_document from public.documents
  where organization_id = '38070000-0000-4000-8000-000000000010' and id = '38070000-0000-4000-8000-000000000301';
  if v_document.category is distinct from 'offer' or v_document.filed_at is null
    or v_document.retention_class::text is distinct from 'ten_years'
    -- The upload kept its name; the sent PDF took the first free one.
    or v_document.display_name is distinct from 'Angebot (2).pdf' then
    raise exception 'the sent PDF is not a filed offer document: %', to_jsonb(v_document);
  end if;
  if (select array_agg(coalesce(link.offer_id::text, '') || '|' || coalesce(link.client_id::text, '')
        || '|' || num_nonnulls(link.job_id, link.project_id, link.employee_id, link.request_id,
          link.equipment_id, link.service_case_id, link.maintenance_coverage_id)
        order by link.offer_id nulls last)
      from public.document_links link
      where link.organization_id = '38070000-0000-4000-8000-000000000010'
        and link.document_id = '38070000-0000-4000-8000-000000000301')
    is distinct from array[pg_temp.id('first') || '||0', '|38070000-0000-4000-8000-000000000020|0'] then
    raise exception 'the sent PDF has links other than its offer and its customer';
  end if;
  if (select status || ':' || version from public.offers
      where organization_id = '38070000-0000-4000-8000-000000000010' and id = pg_temp.id('first'))
    is distinct from 'gesendet:2' then
    raise exception 'the sent offer is not „Gesendet“ at version 2';
  end if;
  select * into v_event from public.offer_events
  where organization_id = '38070000-0000-4000-8000-000000000010'
    and attempt_key = '38070000-0000-4000-8000-000000000101';
  if v_event.event_type is distinct from 'sent' or v_event.payload ->> 'channel' is distinct from 'post'
    or v_event.actor_id is distinct from '38070000-0000-4000-8000-000000000002'::uuid then
    raise exception 'the history row of the send is %', to_jsonb(v_event);
  end if;
end;
$$;

-- A second send of the same draft returns the first revision and registers
-- nothing: under the same key after a lost answer, and from another tab.
do $$
begin
  if pg_temp.send(pg_temp.id('first'), 1, 2, '38070000-0000-4000-8000-000000000101',
      '38070000-0000-4000-8000-000000000302') is distinct from '{"revision": 1,
      "documentId": "38070000-0000-4000-8000-000000000301", "replay": true}'::jsonb
    or pg_temp.send(pg_temp.id('first'), 1, 2, '38070000-0000-4000-8000-000000000102',
      '38070000-0000-4000-8000-000000000303') is distinct from '{"revision": 1,
      "documentId": "38070000-0000-4000-8000-000000000301", "replay": true}'::jsonb then
    raise exception 'a second send of the same draft did not return the first revision';
  end if;
  if (select count(*) from public.offer_revisions
      where organization_id = '38070000-0000-4000-8000-000000000010' and offer_id = pg_temp.id('first'))
      is distinct from 1::bigint
    or exists (select 1 from public.documents where organization_id = '38070000-0000-4000-8000-000000000010'
      and id in ('38070000-0000-4000-8000-000000000302', '38070000-0000-4000-8000-000000000303')) then
    raise exception 'a second send of the same draft registered again';
  end if;
end;
$$;

-- Refusals write nothing.
select pg_temp.expect_refusal(label, format('select pg_temp.send(%L, %s, %s, gen_random_uuid(), gen_random_uuid(), %L, %L)',
  offer, version, content_version, actor, org), refusal)
from (values
  ('a stale content version', pg_temp.id('second'), 1, 1, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'offer_changed'),
  ('a sent offer from other versions', pg_temp.id('first'), 2, 2, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'offer_not_editable'),
  ('an offer without a Position', pg_temp.id('empty'), 1, 1, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'offer_empty'),
  ('an employee', pg_temp.id('second'), 1, 2, '38070000-0000-4000-8000-000000000003',
   '38070000-0000-4000-8000-000000000010', 'not_authorized'),
  ('an outsider', pg_temp.id('second'), 1, 2, '38070000-0000-4000-8000-000000000004',
   '38070000-0000-4000-8000-000000000010', 'not_authorized'),
  ('Büro in another organization', pg_temp.id('second'), 1, 2, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000011', 'not_authorized'),
  ('an offer outside the organization', '38070000-0000-4000-8000-000000000060'::uuid, 1, 2,
   '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010', 'offer_not_found')
) as cases(label, offer, version, content_version, actor, org, refusal);

update public.offers set valid_until = (now() at time zone 'Europe/Berlin')::date - 1
where organization_id = '38070000-0000-4000-8000-000000000010' and id = pg_temp.id('second');
select pg_temp.expect_refusal('an offer valid before the send day',
  format('select pg_temp.send(%L, 1, 2, gen_random_uuid(), gen_random_uuid())', pg_temp.id('second')),
  'offer_expired');
do $$
begin
  if (select count(*) from public.offer_revisions where organization_id = '38070000-0000-4000-8000-000000000010')
      is distinct from 1::bigint
    or (select status from public.offers where organization_id = '38070000-0000-4000-8000-000000000010'
      and id = pg_temp.id('second')) is distinct from 'entwurf' then
    raise exception 'a refused send left a revision or a status behind';
  end if;
end;
$$;

-- A sent revision and its lines are never changed or deleted, whoever writes:
-- the server role holds no grant for it, and the guard refuses even the
-- table's owner. Its PDF, and a library copy of it, is never linked to a job,
-- through the app or directly.
select pg_temp.expect_refusal('the server role changes a revision',
  format('update public.offer_revisions set gross_cents = 1 where offer_id = %L', pg_temp.id('first')), '42501');
reset role;
-- A copy of a library copy of the sent PDF whose intermediate copy was deleted:
-- it names no source any more, only the metadata both copy paths carry over.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  copied_from_document_id, metadata
)
select '38070000-0000-4000-8000-000000000320', '38070000-0000-4000-8000-000000000010',
  '38070000-0000-4000-8000-000000000010/38070000-0000-4000-8000-000000000320/Kopie.pdf', 'Kopie.pdf',
  'Kopie von Kopie von Angebot.pdf', 'offer', 2048, '38070000-0000-4000-8000-000000000002', null, sent.metadata
from public.documents sent
where sent.organization_id = '38070000-0000-4000-8000-000000000010'
  and sent.id = '38070000-0000-4000-8000-000000000301';
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('change the revision''s amounts', format('update public.offer_revisions set gross_cents = 1 where offer_id = %L',
    pg_temp.id('first')), 'event_ledger_history_immutable'),
  ('change a line of the revision', format('update public.offer_revisions
    set content = jsonb_set(content, ''{0,positions,0,unitPriceCents}'', ''1'') where offer_id = %L',
    pg_temp.id('first')), 'event_ledger_history_immutable'),
  ('delete the revision', format('delete from public.offer_revisions where offer_id = %L', pg_temp.id('first')),
    'event_ledger_history_immutable'),
  ('delete the PDF', 'delete from public.documents where id = ''38070000-0000-4000-8000-000000000301''',
    'document_filed'),
  ('link the PDF to a job', format(
    'select public.update_document_links(%L, %L, %L, null, %L, null, null, null, null, null, null)',
    '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    '38070000-0000-4000-8000-000000000301', '{38070000-0000-4000-8000-000000000050}'), 'document_is_offer_original'),
  ('insert a job link directly', $direct$insert into public.document_links
    (organization_id, document_id, job_id, created_by) values ('38070000-0000-4000-8000-000000000010',
    '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000050',
    '38070000-0000-4000-8000-000000000002')$direct$, 'document_is_offer_original'),
  ('link a library copy of the PDF to a job', $direct$insert into public.document_links
    (organization_id, document_id, job_id, created_by) values ('38070000-0000-4000-8000-000000000010',
    '38070000-0000-4000-8000-000000000320', '38070000-0000-4000-8000-000000000050',
    '38070000-0000-4000-8000-000000000002')$direct$, 'document_is_offer_original'),
  ('turn the customer link to a job', $direct$update public.document_links
    set client_id = null, job_id = '38070000-0000-4000-8000-000000000050'
    where document_id = '38070000-0000-4000-8000-000000000301' and client_id is not null$direct$,
    'document_is_offer_original')
) as cases(label, statement, refusal);

-- The recipient snapshot survives a change of the customer.
update public.clients set name = 'WEG Lindenstraße 5 (neu)', address = 'Neuer Weg 2, 10117 Berlin'
where organization_id = '38070000-0000-4000-8000-000000000010' and id = '38070000-0000-4000-8000-000000000020';
do $$
begin
  if (public.list_offer_revisions('38070000-0000-4000-8000-000000000010', pg_temp.id('first')) -> 0)
      - 'sentOn' is distinct from jsonb_build_object('revision', 1, 'channel', 'post',
        'validUntil', (select valid_until from public.offer_revisions
          where organization_id = '38070000-0000-4000-8000-000000000010' and offer_id = pg_temp.id('first')),
        'grossCents', 39151, 'recipientName', 'WEG Lindenstraße 5',
        'documentId', '38070000-0000-4000-8000-000000000301',
        'sentBy', '{"firstName": "Max", "lastName": "Mustermann", "email": "send-buero@example.test"}'::jsonb)
    or (select recipient_address from public.offer_revisions
        where organization_id = '38070000-0000-4000-8000-000000000010' and offer_id = pg_temp.id('first'))
      is distinct from 'Lindenstraße 5, 10115 Berlin'
    or public.list_offer_revisions('38070000-0000-4000-8000-000000000011', pg_temp.id('first'))
      is distinct from '[]'::jsonb then
    raise exception 'the revision read lost its recipient snapshot or crossed an organization';
  end if;
end;
$$;

-- No signed-in role reads a revision or calls the functions; the employee
-- assigned to a job of the same customer reads no offer document.
create function pg_temp.offer_document_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.documents
  where organization_id = '38070000-0000-4000-8000-000000000010' and id = '38070000-0000-4000-8000-000000000301';
  perform pg_temp.expect_refusal('read a revision', 'select count(*) from public.offer_revisions', '42501');
  execute 'reset role';
  return v_count;
end;
$$;
do $$
declare
  v_role text;
begin
  if pg_temp.offer_document_seen_by('38070000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.offer_document_seen_by('38070000-0000-4000-8000-000000000004') is distinct from 0::bigint
    or pg_temp.offer_document_seen_by('38070000-0000-4000-8000-000000000002') is distinct from 1::bigint then
    raise exception 'the sent PDF reached a field worker or another organization, or not the office';
  end if;
  if app_private.can_access_document('38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000003') then
    raise exception 'the employee on the customer''s job may access the sent PDF';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.send_offer(uuid,uuid,uuid,integer,integer,uuid,text,date,text,text,jsonb,uuid,text,text,bigint,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_offer_revisions(uuid,uuid)', 'EXECUTE')
      or has_table_privilege(v_role, 'public.offer_revisions', 'SELECT') then
      raise exception '% reaches the sent revisions', v_role;
    end if;
  end loop;
end;
$$;

-- Editing a sent offer starts revision n+1 (migration
-- 20270601130000_start_the_next_revision_of_a_sent_offer.sql): revision 1 and
-- the Positionen with their costs before the start.
create temporary table before_revision as
select (select to_jsonb(sent) from public.offer_revisions sent
    where sent.organization_id = '38070000-0000-4000-8000-000000000010'
      and sent.offer_id = pg_temp.id('first') and sent.revision = 1) as first_revision,
  (select jsonb_agg(to_jsonb(line) - 'updated_at' order by line.section_id, line.position)
    from public.offer_positions line
    where line.organization_id = '38070000-0000-4000-8000-000000000010'
      and line.offer_id = pg_temp.id('first')) as positions;
grant select on before_revision to service_role;

create function pg_temp.start(
  p_offer uuid, p_version integer, p_key uuid,
  p_actor uuid default '38070000-0000-4000-8000-000000000002',
  p_organization uuid default '38070000-0000-4000-8000-000000000010'
) returns jsonb language sql as $$
  select public.start_offer_revision(p_actor, p_organization, p_offer, p_version, p_key);
$$;
grant execute on function pg_temp.start(uuid, integer, uuid, uuid, uuid) to service_role;

create function pg_temp.revision(p_revision integer) returns public.offer_revisions language sql as $$
  select * from public.offer_revisions revision
  where revision.organization_id = '38070000-0000-4000-8000-000000000010'
    and revision.offer_id = pg_temp.id('first') and revision.revision = p_revision;
$$;
grant execute on function pg_temp.revision(integer) to service_role;

set local role service_role;

-- „Bearbeiten“ on the sent offer: „Entwurf“ again at a new version and content
-- version, the Positionen as sent with their costs, revision 1 untouched, and
-- the history entry naming revision 1, in one call.
do $$
declare
  v_answer jsonb := pg_temp.start(pg_temp.id('first'), 2, '38070000-0000-4000-8000-000000000111');
  v_event public.offer_events;
begin
  if v_answer is distinct from '{"revision": 2, "version": 3, "replay": false}'::jsonb then
    raise exception 'the start of revision 2 answered %', v_answer;
  end if;
  if (select status || ':' || version || ':' || content_version from public.offers
      where organization_id = '38070000-0000-4000-8000-000000000010' and id = pg_temp.id('first'))
    is distinct from 'entwurf:3:3' then
    raise exception 'the started revision is not a draft at version 3 and content version 3';
  end if;
  if (select jsonb_agg(to_jsonb(line) - 'updated_at' order by line.section_id, line.position)
      from public.offer_positions line
      where line.organization_id = '38070000-0000-4000-8000-000000000010'
        and line.offer_id = pg_temp.id('first'))
    is distinct from (select positions from before_revision) then
    raise exception 'the start of revision 2 changed the Positionen or their costs';
  end if;
  if to_jsonb(pg_temp.revision(1)) is distinct from (select first_revision from before_revision) then
    raise exception 'the start of revision 2 changed revision 1';
  end if;
  select * into v_event from public.offer_events
  where organization_id = '38070000-0000-4000-8000-000000000010'
    and attempt_key = '38070000-0000-4000-8000-000000000111';
  if v_event.event_type is distinct from 'revision_started' or v_event.status is distinct from 'entwurf'
    or v_event.version is distinct from 3
    or v_event.payload is distinct from '{"revision": 2, "replaces": 1, "fromVersion": 2,
      "contentVersion": 3}'::jsonb
    or v_event.actor_id is distinct from '38070000-0000-4000-8000-000000000002'::uuid then
    raise exception 'the history row of the start is %', to_jsonb(v_event);
  end if;
end;
$$;

-- A press repeated after a lost answer, and the same sent version started from
-- another tab, answer the first start and write nothing.
do $$
begin
  if pg_temp.start(pg_temp.id('first'), 2, '38070000-0000-4000-8000-000000000111')
      is distinct from '{"revision": 2, "version": 3, "replay": true}'::jsonb
    or pg_temp.start(pg_temp.id('first'), 2, '38070000-0000-4000-8000-000000000112')
      is distinct from '{"revision": 2, "version": 3, "replay": true}'::jsonb then
    raise exception 'a repeated start did not answer the first one';
  end if;
  if (select count(*) from public.offer_events where organization_id = '38070000-0000-4000-8000-000000000010'
      and offer_id = pg_temp.id('first') and event_type = 'revision_started') is distinct from 1::bigint
    or (select version from public.offers where organization_id = '38070000-0000-4000-8000-000000000010'
      and id = pg_temp.id('first')) is distinct from 3 then
    raise exception 'a repeated start wrote again';
  end if;
end;
$$;

-- No revision starts while a draft revision is open, from a draft never sent,
-- for a field worker, an outsider or another organization; refusals write nothing.
select pg_temp.expect_refusal(label, format('select pg_temp.start(%L, %s, gen_random_uuid(), %L, %L)',
  offer, version, actor, org), refusal)
from (values
  ('a second start while revision 2 is a draft', pg_temp.id('first'), 3,
   '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010', 'offer_not_sent'),
  ('a draft never sent', pg_temp.id('empty'), 1, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'offer_not_sent'),
  ('an employee', pg_temp.id('first'), 3, '38070000-0000-4000-8000-000000000003',
   '38070000-0000-4000-8000-000000000010', 'not_authorized'),
  ('an outsider', pg_temp.id('first'), 3, '38070000-0000-4000-8000-000000000004',
   '38070000-0000-4000-8000-000000000010', 'not_authorized'),
  ('Büro in another organization', pg_temp.id('first'), 3, '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000011', 'not_authorized'),
  ('an offer outside the organization', '38070000-0000-4000-8000-000000000060'::uuid, 3,
   '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010', 'offer_not_found')
) as cases(label, offer, version, actor, org, refusal);

-- Sending the unchanged draft freezes revision 2 with exactly revision 1's
-- content and no cost, numbered after the newest sent one; revision 1 stays
-- as it was and reads as replaced, derived from revision 2.
do $$
declare
  v_answer jsonb := pg_temp.send(pg_temp.id('first'), 3, 3, '38070000-0000-4000-8000-000000000121',
    '38070000-0000-4000-8000-000000000304');
begin
  if v_answer is distinct from '{"revision": 2, "documentId": "38070000-0000-4000-8000-000000000304",
      "replay": false}'::jsonb then
    raise exception 'the send of revision 2 answered %', v_answer;
  end if;
  if (pg_temp.revision(2)).content is distinct from (pg_temp.revision(1)).content
    or to_jsonb(pg_temp.revision(2))::text ~* 'cost|margin' then
    raise exception 'revision 2 is not revision 1''s content without cost: %', to_jsonb(pg_temp.revision(2));
  end if;
  if to_jsonb(pg_temp.revision(1)) is distinct from (select first_revision from before_revision) then
    raise exception 'sending revision 2 changed revision 1';
  end if;
  if (select jsonb_agg(entry -> 'revision')
      from jsonb_array_elements(public.list_offer_revisions('38070000-0000-4000-8000-000000000010',
        pg_temp.id('first'))) entry) is distinct from '[2, 1]'::jsonb then
    raise exception 'the revision list is not revision 2, then revision 1';
  end if;
end;
$$;

-- A second send of revision 2, under its key or from another tab, returns it
-- and registers nothing.
do $$
begin
  if pg_temp.send(pg_temp.id('first'), 3, 3, '38070000-0000-4000-8000-000000000121',
      '38070000-0000-4000-8000-000000000305') is distinct from '{"revision": 2,
      "documentId": "38070000-0000-4000-8000-000000000304", "replay": true}'::jsonb
    or pg_temp.send(pg_temp.id('first'), 3, 3, '38070000-0000-4000-8000-000000000122',
      '38070000-0000-4000-8000-000000000306') is distinct from '{"revision": 2,
      "documentId": "38070000-0000-4000-8000-000000000304", "replay": true}'::jsonb then
    raise exception 'a second send of revision 2 did not return it';
  end if;
  if (select count(*) from public.offer_revisions where organization_id = '38070000-0000-4000-8000-000000000010'
      and offer_id = pg_temp.id('first')) is distinct from 2::bigint then
    raise exception 'a second send of revision 2 froze another revision';
  end if;
end;
$$;

-- A start from a version before revision 2 was sent is refused, and so is the
-- key of revision 2's start sent again from the version revision 2 left: it
-- names another start, never a replay that leaves no draft.
select pg_temp.expect_refusal('a start from an older version', format(
  'select pg_temp.start(%L, 3, gen_random_uuid())', pg_temp.id('first')), 'offer_changed');
select pg_temp.expect_refusal('an earlier start''s key from a later version', format(
  'select pg_temp.start(%L, 4, %L)', pg_temp.id('first'), '38070000-0000-4000-8000-000000000111'),
  'invalid_input');

-- Revision 3 with a changed price: revisions 1 and 2 keep theirs. A further
-- revision that is never sent stays a draft, and revision 3 stays the newest sent one.
do $$
declare
  v_second public.offer_revisions := pg_temp.revision(2);
  v_started jsonb;
begin
  perform pg_temp.start(pg_temp.id('first'), 4, gen_random_uuid());
  perform public.save_offer_content('38070000-0000-4000-8000-000000000002',
    '38070000-0000-4000-8000-000000000010', pg_temp.id('first'), 4, gen_random_uuid(),
    jsonb_set(jsonb_set(jsonb_set(pg_temp.content(), '{0,positions,0,unitPriceCents}', '11000'),
      '{0,positions,0,amountCents}', '22000'), '{0,netCents}', '34900'),
    '{"netCents": 34900, "taxCents": 6631, "grossCents": 41531}');
  if pg_temp.send(pg_temp.id('first'), 5, 5, gen_random_uuid(), '38070000-0000-4000-8000-000000000307')
      ->> 'revision' is distinct from '3' then
    raise exception 'the changed draft was not sent as revision 3';
  end if;
  if (pg_temp.revision(3)).gross_cents is distinct from 41531::bigint
    or (pg_temp.revision(3)).content #>> '{0,positions,0,unitPriceCents}' is distinct from '11000'
    or to_jsonb(pg_temp.revision(2)) is distinct from to_jsonb(v_second)
    or to_jsonb(pg_temp.revision(1)) is distinct from (select first_revision from before_revision) then
    raise exception 'sending revision 3 changed an earlier revision';
  end if;
  -- Its own statement: a condition beside it would read the offer as it was before the call.
  v_started := pg_temp.start(pg_temp.id('first'), 6, gen_random_uuid());
  if v_started ->> 'revision' is distinct from '4'
    or public.list_offer_revisions('38070000-0000-4000-8000-000000000010', pg_temp.id('first')) -> 0 ->> 'revision'
      is distinct from '3'
    or (select status from public.offers where organization_id = '38070000-0000-4000-8000-000000000010'
      and id = pg_temp.id('first')) is distinct from 'entwurf' then
    raise exception 'an unsent revision 4 is not a draft beside revision 3 as the newest sent one';
  end if;
end;
$$;

reset role;
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.start_offer_revision(uuid,uuid,uuid,integer,uuid)', 'EXECUTE') then
      raise exception '% may start a revision', v_role;
    end if;
  end loop;
end;
$$;

rollback;
