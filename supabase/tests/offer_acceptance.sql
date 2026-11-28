-- The office records who accepted which revision of an offer, when and how,
-- and the accepted scope is frozen; or it records a rejection or withdraws the
-- offer (migration 20270701120000_record_an_offer_acceptance_and_freeze_its_scope.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38590000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'accept-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38590000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'accept-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38590000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'accept-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38590000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'accept-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38590000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Annahme', '38590000-0000-4000-8000-000000000001', 'OFFACPT'),
('38590000-0000-4000-8000-000000000011', 'Fremde Haustechnik Annahme', '38590000-0000-4000-8000-000000000004', 'OFFACPO');
insert into public.organization_members (organization_id, user_id, role) values
('38590000-0000-4000-8000-000000000010', '38590000-0000-4000-8000-000000000002', 'buero'),
('38590000-0000-4000-8000-000000000010', '38590000-0000-4000-8000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, client_type, address) values
('38590000-0000-4000-8000-000000000020', '38590000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');

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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from ids where name = p_name;
$$;
grant execute on function pg_temp.id(text) to service_role;

-- A priced Position of `p_type` at p_cents, with the office's cost.
create function pg_temp.priced(p_name text, p_cents integer, p_type jsonb) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'free', 'name', p_name, 'description', '',
    'quantity', '1', 'unit', 'piece', 'unitLabel', 'Stk.', 'unitPriceCents', p_cents, 'priceQuantity', 1,
    'taxRateBasisPoints', 1900, 'amountCents', p_cents,
    'purchaseCost', jsonb_build_object('amountCents', 1000, 'priceQuantity', 1), 'positionType', p_type);
$$;
grant execute on function pg_temp.priced(text, integer, jsonb) to service_role;

-- Titel 1: 1.1 a boiler, a text line, 1.2 a Neutralisationsbox if needed, 1.3 and 1.4
-- instead of 1.1. Titel 2: 2.1 the Montage. The offer sums 4.890,00 € + 800,00 € net.
create function pg_temp.content() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('title', 'Wärmeerzeuger', 'netCents', 489000, 'positions', jsonb_build_array(
      pg_temp.priced('Gas-Brennwerttherme 25 kW', 489000, '{"kind": "normal"}'),
      '{"kind": "text", "name": "Hinweis", "description": ""}'::jsonb,
      pg_temp.priced('Neutralisationsbox', 18500, '{"kind": "bedarf"}'),
      pg_temp.priced('Gas-Brennwerttherme 20 kW', 452000, '{"kind": "alternative", "alternativeTo": 1}'),
      pg_temp.priced('Luft-Wasser-Wärmepumpe', 900000, '{"kind": "alternative", "alternativeTo": 1}'))),
    jsonb_build_object('title', 'Montage', 'netCents', 80000, 'positions', jsonb_build_array(
      pg_temp.priced('Montagepauschale', 80000, '{"kind": "normal"}'))));
$$;
grant execute on function pg_temp.content() to service_role;

-- Saves the content into the draft at p_version and sends it as Büro with a new document.
create function pg_temp.save_and_send(p_offer uuid, p_version integer, p_content_version integer)
returns jsonb language plpgsql as $$
declare
  v_document uuid := gen_random_uuid();
begin
  perform public.save_offer_content('38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', p_offer, p_content_version, gen_random_uuid(), pg_temp.content(),
    '{"netCents": 569000, "taxCents": 108110, "grossCents": 677110, "positionTypes": true}');
  return public.send_offer('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
    p_offer, p_version, p_content_version + 1, gen_random_uuid(), 'post',
    (now() at time zone 'Europe/Berlin')::date, 'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin',
    '{"site": null, "positionTypes": true}', v_document,
    '38590000-0000-4000-8000-000000000010/' || v_document || '/Angebot.pdf',
    'Angebot ' || p_offer || '.pdf', 2048, repeat('b', 64));
end;
$$;
grant execute on function pg_temp.save_and_send(uuid, integer, integer) to service_role;

-- An Annahme as Büro of the newest revision with the totals the server computed.
create function pg_temp.accept(
  p_offer uuid, p_version integer, p_key uuid, p_options text[], p_net bigint, p_tax bigint,
  p_revision integer default 1,
  p_accepted_on date default (now() at time zone 'Europe/Berlin')::date,
  p_actor uuid default '38590000-0000-4000-8000-000000000002',
  p_organization uuid default '38590000-0000-4000-8000-000000000010'
) returns jsonb language sql as $$
  select public.accept_offer(p_actor, p_organization, p_offer, p_version, p_key, p_revision,
    '  Erika Musterfrau ', p_accepted_on, 'unterschrift', 'Unterschrieben vor Ort zurückgegeben.', p_options,
    jsonb_build_object('netCents', p_net, 'taxCents', p_tax, 'grossCents', p_net + p_tax));
$$;
grant execute on function pg_temp.accept(uuid, integer, uuid, text[], bigint, bigint, integer, date, uuid, uuid)
  to service_role;

set local role service_role;
insert into ids
select name, public.create_offer('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  gen_random_uuid(), name, '38590000-0000-4000-8000-000000000020', null, null, null, null)
from unnest(array['accepted', 'revised', 'drafting', 'rejected', 'withdrawn', 'unsent']) name;
-- Every offer but „unsent“ is sent as revision 1 (version 2).
select pg_temp.save_and_send(pg_temp.id(name), 1, 1) from ids where name <> 'unsent';
-- „revised“ is sent again as revision 2 (version 4); „drafting“ holds an open draft of revision 2 (version 3).
select public.start_offer_revision('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  pg_temp.id(name), 2, gen_random_uuid())
from ids where name in ('revised', 'drafting');
select pg_temp.save_and_send(pg_temp.id('revised'), 3, 3);

-- An Annahme of the newest revision with the Neutralisationsbox and 1.3 instead of 1.1:
-- the Auftragsumfang keeps the text line, 1.2 and 1.3 marked as chosen and 2.1, and leaves
-- out 1.1 and the unchosen 1.4. Its net is the revision's plus 1.2 plus 1.3 less 1.1.
do $$
declare
  v_answer jsonb := pg_temp.accept(pg_temp.id('accepted'), 2, '38590000-0000-4000-8000-000000000101',
    array['1.2', '1.3'], 550500, 104595);
  v_acceptance public.offer_acceptances;
  v_revision public.offer_revisions;
  v_event public.offer_events;
begin
  if v_answer ->> 'replay' is distinct from 'false' or v_answer ->> 'version' is distinct from '3' then
    raise exception 'the Annahme answered %', v_answer;
  end if;
  select * into v_acceptance from public.offer_acceptances acceptance
  where acceptance.organization_id = '38590000-0000-4000-8000-000000000010'
    and acceptance.offer_id = pg_temp.id('accepted');
  select * into v_revision from public.offer_revisions revision
  where revision.organization_id = '38590000-0000-4000-8000-000000000010'
    and revision.offer_id = pg_temp.id('accepted') and revision.revision = 1;
  if v_acceptance.id::text is distinct from v_answer ->> 'acceptanceId'
    or v_acceptance.revision is distinct from 1
    or v_acceptance.accepted_by_name is distinct from 'Erika Musterfrau'
    or v_acceptance.channel is distinct from 'unterschrift'
    or v_acceptance.chosen_options is distinct from array['1.2', '1.3']
    or v_acceptance.recorded_by is distinct from '38590000-0000-4000-8000-000000000002' then
    raise exception 'the Annahme was recorded as %', to_jsonb(v_acceptance) - 'scope';
  end if;
  if v_acceptance.net_cents is distinct from v_revision.net_cents + 18500 + 452000 - 489000
    or v_acceptance.gross_cents is distinct from 655095 then
    raise exception 'the scope totals % are not the revision''s % with the chosen options',
      v_acceptance.net_cents, v_revision.net_cents;
  end if;
  if (select jsonb_agg(line.value ->> 'number' order by section.ordinality, line.ordinality)
      from jsonb_array_elements(v_acceptance.scope) with ordinality section(value, ordinality),
        jsonb_array_elements(section.value -> 'positions') with ordinality line(value, ordinality))
      is distinct from '[null, "1.2", "1.3", "2.1"]'::jsonb
    or v_acceptance.scope #>> '{0,netCents}' is distinct from '470500'
    or v_acceptance.scope #>> '{1,netCents}' is distinct from '80000'
    or v_acceptance.scope #> '{0,positions,1}' is distinct from
      (v_revision.content #> '{0,positions,2}') - 'positionType' || '{"option": "bedarf"}'
    or v_acceptance.scope #> '{0,positions,2}' is distinct from
      (v_revision.content #> '{0,positions,3}') - 'positionType' - 'alternativeTo'
        || '{"option": "alternative", "replaces": "1.1"}'
    or jsonb_path_exists(v_acceptance.scope, '$.**.purchaseCost') then
    raise exception 'the Auftragsumfang is %', v_acceptance.scope;
  end if;
  if (select status from public.offers where id = pg_temp.id('accepted')) is distinct from 'angenommen' then
    raise exception 'the accepted offer is not „Angenommen“';
  end if;
  select * into v_event from public.offer_events event
  where event.organization_id = '38590000-0000-4000-8000-000000000010'
    and event.attempt_key = '38590000-0000-4000-8000-000000000101';
  if v_event.event_type is distinct from 'accepted' or v_event.status is distinct from 'angenommen'
    or v_event.payload ->> 'acceptanceId' is distinct from v_acceptance.id::text
    or v_event.payload::text like '%Musterfrau%' then
    raise exception 'the history of the Annahme is %', to_jsonb(v_event);
  end if;
end;
$$;

-- A repeated press answers the first Annahme and writes nothing.
do $$
begin
  if pg_temp.accept(pg_temp.id('accepted'), 2, '38590000-0000-4000-8000-000000000101',
      array['1.2', '1.3'], 550500, 104595) ->> 'replay' is distinct from 'true'
    or (select count(*) from public.offer_acceptances where offer_id = pg_temp.id('accepted')) <> 1 then
    raise exception 'a repeated Annahme wrote a second one';
  end if;
end;
$$;

-- A second Annahme while one stands, an Annahme of a replaced revision, of a never sent
-- offer, or by another state of the offer is refused, and so is every invalid choice.
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('a second Annahme', format('select pg_temp.accept(%L, 3, gen_random_uuid(), ''{}'', 569000, 108110)',
    pg_temp.id('accepted')), 'offer_decided'),
  ('an Annahme of a replaced revision', format(
    'select pg_temp.accept(%L, 4, gen_random_uuid(), ''{}'', 569000, 108110, 1)', pg_temp.id('revised')),
    'revision_superseded'),
  ('an Annahme of the open draft''s revision', format(
    'select pg_temp.accept(%L, 3, gen_random_uuid(), ''{}'', 569000, 108110, 2)', pg_temp.id('drafting')),
    'invalid_input'),
  ('an Annahme of a never sent offer', format(
    'select pg_temp.accept(%L, 1, gen_random_uuid(), ''{}'', 569000, 108110)', pg_temp.id('unsent')),
    'offer_not_sent'),
  ('an Annahme from an older version', format(
    'select pg_temp.accept(%L, 1, gen_random_uuid(), ''{}'', 569000, 108110)', pg_temp.id('rejected')),
    'offer_changed'),
  ('a normal Position chosen as an option', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{1.1}'', 569000, 108110)', pg_temp.id('rejected')),
    'invalid_input'),
  ('an unknown option', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{9.9}'', 569000, 108110)', pg_temp.id('rejected')),
    'invalid_input'),
  ('an option chosen twice', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{1.2,1.2}'', 606000, 115140)', pg_temp.id('rejected')),
    'invalid_input'),
  ('two Alternativpositionen for one Position', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{1.3,1.4}'', 569000, 108110)', pg_temp.id('rejected')),
    'invalid_input'),
  ('totals that are not the scope''s', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{1.2}'', 569000, 108110)', pg_temp.id('rejected')),
    'scope_mismatch'),
  ('an Annahme dated tomorrow', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{}'', 569000, 108110, 1, %L)', pg_temp.id('rejected'),
    (now() at time zone 'Europe/Berlin')::date + 1), 'invalid_input'),
  ('an Annahme dated before the send', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{}'', 569000, 108110, 1, %L)', pg_temp.id('rejected'),
    (now() at time zone 'Europe/Berlin')::date - 1), 'invalid_input'),
  ('an Annahme without a name', format($statement$select public.accept_offer(%L, %L, %L, 2, gen_random_uuid(),
    1, '  ', current_date, 'email', '', '{}', '{"netCents": 569000, "taxCents": 108110, "grossCents": 677110}')$statement$,
    '38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010', pg_temp.id('rejected')),
    'invalid_input'),
  ('an Annahme by an employee', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{}'', 569000, 108110, 1, current_date, %L)',
    pg_temp.id('rejected'), '38590000-0000-4000-8000-000000000003'), 'not_authorized'),
  ('an Annahme by another organization''s admin', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{}'', 569000, 108110, 1, current_date, %L)',
    pg_temp.id('rejected'), '38590000-0000-4000-8000-000000000004'), 'not_authorized'),
  ('an Annahme of this offer in another organization', format(
    'select pg_temp.accept(%L, 2, gen_random_uuid(), ''{}'', 569000, 108110, 1, current_date, %L, %L)',
    pg_temp.id('rejected'), '38590000-0000-4000-8000-000000000004', '38590000-0000-4000-8000-000000000011'),
    'offer_not_found')
) refusals(label, statement, refusal);

-- The Annahme of revision 1 while the draft of revision 2 is open stands, and the draft is
-- closed in the same call with its own history entry, which says it held changes.
select public.save_offer_content('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  pg_temp.id('drafting'), 3, gen_random_uuid(), pg_temp.content() #- '{1}',
  '{"netCents": 489000, "taxCents": 92910, "grossCents": 581910, "positionTypes": true}');
do $$
declare
  v_answer jsonb := pg_temp.accept(pg_temp.id('drafting'), 3, gen_random_uuid(), '{}', 569000, 108110);
  v_closed public.offer_events;
begin
  select * into v_closed from public.offer_events event
  where event.organization_id = '38590000-0000-4000-8000-000000000010'
    and event.offer_id = pg_temp.id('drafting') and event.event_type = 'draft_closed';
  if (select status from public.offers where id = pg_temp.id('drafting')) is distinct from 'angenommen'
    or (select revision from public.offer_acceptances where offer_id = pg_temp.id('drafting')) is distinct from 1
    or v_closed.payload is distinct from
      '{"revision": 2, "decidedRevision": 1, "cause": "accepted", "draftChanged": true}'::jsonb
    or v_closed.status is distinct from 'angenommen' or v_closed.version is distinct from 4
    or (v_answer ->> 'version')::integer is distinct from 4 then
    raise exception 'the Annahme beside the open draft answered % and closed it as %', v_answer, to_jsonb(v_closed);
  end if;
  -- The closed draft is no longer edited or sent.
  perform pg_temp.expect_refusal('a save of the closed draft', format($statement$select public.save_offer_content(
    '38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010', %L, 4, gen_random_uuid(),
    '[]', '{"netCents": 0, "taxCents": 0, "grossCents": 0, "positionTypes": true}')$statement$,
    pg_temp.id('drafting')), 'offer_not_editable');
end;
$$;

-- An Annahme and its Auftragsumfang never change and are never deleted, whoever writes.
select pg_temp.expect_refusal('the server role changes an Annahme',
  format('update public.offer_acceptances set accepted_by_name = %L where offer_id = %L', 'Max',
    pg_temp.id('accepted')), '42501');
reset role;
select pg_temp.expect_refusal(label, statement, 'event_ledger_history_immutable')
from (values
  ('change the accepting person', format('update public.offer_acceptances set accepted_by_name = %L
    where offer_id = %L', 'Max Mustermann', pg_temp.id('accepted'))),
  ('change the Auftragsumfang', format('update public.offer_acceptances
    set scope = jsonb_set(scope, ''{0,positions,1,amountCents}'', ''1''), net_cents = 1, gross_cents = 1 + tax_cents
    where offer_id = %L', pg_temp.id('accepted'))),
  ('delete the Annahme', format('delete from public.offer_acceptances where offer_id = %L', pg_temp.id('accepted')))
) attempts(label, statement);
set local role service_role;

-- A mistaken Annahme is withdrawn with a reason: a new row names it, the Annahme stays,
-- the offer is „Gesendet“ again and can take the right Annahme.
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('a withdrawal from an older version', format($statement$select public.withdraw_offer_acceptance(%L, %L, %L, 2,
    gen_random_uuid(), 'Falsches Angebot erfasst')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('accepted')), 'offer_changed'),
  ('a withdrawal without a reason', format($statement$select public.withdraw_offer_acceptance(%L, %L, %L, 3,
    gen_random_uuid(), ' ')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('accepted')), 'invalid_input'),
  ('a withdrawal of an offer not accepted', format($statement$select public.withdraw_offer_acceptance(%L, %L, %L, 4,
    gen_random_uuid(), 'Falsch')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('revised')), 'offer_not_accepted'),
  ('a withdrawal by an employee', format($statement$select public.withdraw_offer_acceptance(%L, %L, %L, 3,
    gen_random_uuid(), 'Falsch')$statement$, '38590000-0000-4000-8000-000000000003',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('accepted')), 'not_authorized')
) refusals(label, statement, refusal);
do $$
declare
  v_answer jsonb := public.withdraw_offer_acceptance('38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('accepted'), 3, '38590000-0000-4000-8000-000000000102',
    ' Beim falschen Angebot erfasst ');
begin
  if v_answer ->> 'version' is distinct from '4'
    or (select status from public.offers where id = pg_temp.id('accepted')) is distinct from 'gesendet'
    or (select count(*) from public.offer_acceptances where offer_id = pg_temp.id('accepted')) <> 1
    or (select withdrawal.reason from public.offer_acceptance_withdrawals withdrawal
        join public.offer_acceptances acceptance on acceptance.id = withdrawal.acceptance_id
        where acceptance.offer_id = pg_temp.id('accepted')) is distinct from 'Beim falschen Angebot erfasst' then
    raise exception 'the withdrawal answered % and left the Annahme as it was not', v_answer;
  end if;
  if (select event.payload ->> 'acceptanceId' from public.offer_events event
      where event.attempt_key = '38590000-0000-4000-8000-000000000102'
        and event.organization_id = '38590000-0000-4000-8000-000000000010')
      is distinct from (select id::text from public.offer_acceptances where offer_id = pg_temp.id('accepted')) then
    raise exception 'the history of the withdrawal does not name the Annahme';
  end if;
  -- The right Annahme follows on the same revision.
  perform pg_temp.accept(pg_temp.id('accepted'), 4, gen_random_uuid(), '{}', 569000, 108110);
  if (select count(*) from public.offer_acceptances where offer_id = pg_temp.id('accepted')) <> 2 then
    raise exception 'the Annahme after a withdrawal was not recorded';
  end if;
end;
$$;
reset role;
select pg_temp.expect_refusal(label, statement, 'event_ledger_history_immutable')
from (values
  ('change a withdrawal', 'update public.offer_acceptance_withdrawals set reason = ''Anders'''),
  ('delete a withdrawal', 'delete from public.offer_acceptance_withdrawals')
) attempts(label, statement);
set local role service_role;

-- The office records a rejection, or withdraws its offer, with a reason; an open draft
-- closes with it, and a closed offer takes no Annahme and no second closing.
select public.close_offer('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  pg_temp.id('rejected'), 2, gen_random_uuid(), 'abgelehnt', 'Zu teuer');
select public.start_offer_revision('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  pg_temp.id('withdrawn'), 2, gen_random_uuid());
select public.close_offer('38590000-0000-4000-8000-000000000002', '38590000-0000-4000-8000-000000000010',
  pg_temp.id('withdrawn'), 3, gen_random_uuid(), 'zurueckgezogen', 'Lieferant kann nicht liefern');
do $$
begin
  if (select status from public.offers where id = pg_temp.id('rejected')) is distinct from 'abgelehnt'
    or (select status from public.offers where id = pg_temp.id('withdrawn')) is distinct from 'zurueckgezogen'
    or (select payload from public.offer_events where offer_id = pg_temp.id('withdrawn')
        and event_type = 'draft_closed' and organization_id = '38590000-0000-4000-8000-000000000010')
      is distinct from '{"revision": 2, "decidedRevision": 1, "cause": "withdrawn", "draftChanged": false}'::jsonb
    or (public.get_offer_decisions('38590000-0000-4000-8000-000000000010', pg_temp.id('rejected')) -> 'closing')
      - 'recordedAt' - 'recordedBy' is distinct from
      '{"outcome": "abgelehnt", "revision": 1, "reason": "Zu teuer"}'::jsonb then
    raise exception 'a rejection or withdrawal was not recorded with its reason';
  end if;
end;
$$;
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('an Annahme of a rejected offer', format('select pg_temp.accept(%L, 3, gen_random_uuid(), ''{}'', 569000, 108110)',
    pg_temp.id('rejected')), 'offer_decided'),
  ('a second closing', format($statement$select public.close_offer(%L, %L, %L, 3, gen_random_uuid(),
    'zurueckgezogen', 'Doch nicht')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('rejected')), 'offer_decided'),
  ('a closing of a never sent offer', format($statement$select public.close_offer(%L, %L, %L, 1, gen_random_uuid(),
    'zurueckgezogen', 'Nicht mehr nötig')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('unsent')), 'offer_not_sent'),
  ('a closing without a reason', format($statement$select public.close_offer(%L, %L, %L, 4, gen_random_uuid(),
    'abgelehnt', '')$statement$, '38590000-0000-4000-8000-000000000002',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('revised')), 'invalid_input'),
  ('a closing by an employee', format($statement$select public.close_offer(%L, %L, %L, 4, gen_random_uuid(),
    'abgelehnt', 'Zu teuer')$statement$, '38590000-0000-4000-8000-000000000003',
    '38590000-0000-4000-8000-000000000010', pg_temp.id('revised')), 'not_authorized')
) refusals(label, statement, refusal);

-- The page's read carries the Annahmen, newest first with the withdrawn one marked, and
-- another organization's offer has none.
do $$
declare
  v_decisions jsonb := public.get_offer_with_revisions('38590000-0000-4000-8000-000000000010',
    pg_temp.id('accepted')) -> 'decisions';
begin
  if jsonb_array_length(v_decisions -> 'acceptances') is distinct from 2
    or v_decisions #> '{acceptances,0,withdrawal}' is distinct from 'null'::jsonb
    or v_decisions #>> '{acceptances,1,withdrawal,reason}' is distinct from 'Beim falschen Angebot erfasst'
    or v_decisions #>> '{acceptances,1,acceptedByName}' is distinct from 'Erika Musterfrau'
    or v_decisions #>> '{acceptances,1,recordedBy,lastName}' is distinct from 'Mustermann'
    or v_decisions -> 'closing' is distinct from 'null'::jsonb
    or public.get_offer_decisions('38590000-0000-4000-8000-000000000011', pg_temp.id('accepted'))
      is distinct from '{"acceptances": [], "closing": null}'::jsonb then
    raise exception 'the offer page read the decisions as %', v_decisions;
  end if;
end;
$$;

-- No client role reads a row or runs a function.
reset role;
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.offer_acceptances', 'SELECT')
      or has_table_privilege(v_role, 'public.offer_acceptance_withdrawals', 'SELECT')
      or has_function_privilege(v_role,
        'public.accept_offer(uuid,uuid,uuid,integer,uuid,integer,text,date,text,text,text[],jsonb)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.withdraw_offer_acceptance(uuid,uuid,uuid,integer,uuid,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.close_offer(uuid,uuid,uuid,integer,uuid,text,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.get_offer_decisions(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role,
        'app_private.close_offer_draft(public.offers,uuid,integer,text,text)', 'EXECUTE') then
      raise exception '% reads an Annahme or runs its functions', v_role;
    end if;
  end loop;
end;
$$;

rollback;
