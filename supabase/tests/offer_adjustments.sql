-- An offer holds Nachlässe and Zuschläge as Positionen of their own: each
-- counts in its Titel's sum with its parts by VAT rate, which add up to it; a
-- sent revision keeps them; starting the next revision keeps every kind of
-- Position as it was; an older build neither saves nor sends an offer holding
-- one (migration 20270701140000_add_discount_and_surcharge_positions_to_an_offer.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('36110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'adjust-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('36110000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'adjust-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('36110000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'adjust-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('36110000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'adjust-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('36110000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Nachlässe', '36110000-0000-4000-8000-000000000001', 'OFFADJ'),
('36110000-0000-4000-8000-000000000011', 'Fremde Haustechnik Nachlässe', '36110000-0000-4000-8000-000000000004', 'OFFADJO');
insert into public.organization_members (organization_id, user_id, role) values
('36110000-0000-4000-8000-000000000010', '36110000-0000-4000-8000-000000000002', 'buero'),
('36110000-0000-4000-8000-000000000010', '36110000-0000-4000-8000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, client_type, address) values
('36110000-0000-4000-8000-000000000020', '36110000-0000-4000-8000-000000000010',
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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;
grant select on ids to authenticated;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from ids where name = p_name;
$$;
grant execute on function pg_temp.id(text) to service_role, authenticated;

-- A priced Position of `p_type` at p_cents and p_rate, with the office's cost.
create function pg_temp.priced(p_name text, p_cents integer, p_rate integer, p_type jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('kind', 'free', 'name', p_name, 'description', '',
    'quantity', '1', 'unit', 'piece', 'unitLabel', 'Stk.', 'unitPriceCents', p_cents, 'priceQuantity', 1,
    'taxRateBasisPoints', p_rate, 'amountCents', p_cents,
    'purchaseCost', jsonb_build_object('amountCents', 1000, 'priceQuantity', 1), 'positionType', p_type);
$$;
grant execute on function pg_temp.priced(text, integer, integer, jsonb) to service_role;

-- One Titel: 1.1 a boiler at 19 %, 1.2 a booklet at 7 %, 1.3 a Bedarfsposition,
-- 1.4 an Alternativposition to 1.1, a text line, 1.5 3 % off the Titel's normal
-- Positionen (3,00 € at 19 % and 1,50 € at 7 %), 1.6 a fixed Zuschlag of 15,00 €
-- at 19 %. The Titel sums 100,00 + 50,00 - 4,50 + 15,00 = 160,50 €.
create function pg_temp.content(p_net bigint default 16050) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('title', 'Heizung', 'netCents', p_net, 'positions',
    jsonb_build_array(
      pg_temp.priced('Gas-Brennwerttherme', 10000, 1900, '{"kind": "normal"}'),
      pg_temp.priced('Wartungsheft', 5000, 700, '{"kind": "normal"}'),
      pg_temp.priced('Neutralisationsbox', 20000, 1900, '{"kind": "bedarf"}'),
      pg_temp.priced('Gas-Brennwerttherme klein', 8000, 1900, '{"kind": "alternative", "alternativeTo": 1}'),
      '{"kind": "text", "name": "Hinweis", "description": ""}'::jsonb,
      '{"kind": "adjustment", "name": "Nachlass", "description": "Für Stammkunden",
        "adjustment": {"direction": "rabatt", "scope": "titel", "percentHundredths": 300},
        "amountCents": -450, "taxSplit": [{"taxRateBasisPoints": 1900, "amountCents": -300},
          {"taxRateBasisPoints": 700, "amountCents": -150}]}'::jsonb,
      '{"kind": "adjustment", "name": "Kleinmengenzuschlag", "description": "",
        "adjustment": {"direction": "zuschlag", "scope": "betrag", "amountCents": 1500, "taxRateBasisPoints": 1900},
        "amountCents": 1500, "taxSplit": [{"taxRateBasisPoints": 1900, "amountCents": 1500}]}'::jsonb)));
$$;
grant execute on function pg_temp.content(bigint) to service_role;

create function pg_temp.save(p_offer uuid, p_content jsonb, p_net bigint default 16050,
  p_organization uuid default '36110000-0000-4000-8000-000000000010',
  p_actor uuid default '36110000-0000-4000-8000-000000000002', p_version integer default 1,
  p_marks jsonb default '{"positionTypes": true, "adjustments": true}')
  returns jsonb language sql as $$
  select public.save_offer_content(p_actor, p_organization, p_offer, p_version,
    gen_random_uuid(), p_content, jsonb_build_object('netCents', p_net, 'taxCents', 3001, 'grossCents', 19051)
      || p_marks);
$$;
grant execute on function pg_temp.save(uuid, jsonb, bigint, uuid, uuid, integer, jsonb) to service_role;

-- No client role holds a privilege on a Nachlass's columns: the server reads them.
do $$
begin
  if has_column_privilege('authenticated', 'public.offer_positions', 'price_adjustment', 'SELECT')
    or has_column_privilege('authenticated', 'public.offer_positions', 'tax_split', 'SELECT')
    or has_column_privilege('anon', 'public.offer_positions', 'price_adjustment_scope', 'SELECT') then
    raise exception 'a client role reads a Nachlass';
  end if;
end;
$$;

set local role service_role;
insert into ids
select 'offer', public.create_offer('36110000-0000-4000-8000-000000000002', '36110000-0000-4000-8000-000000000010',
  gen_random_uuid(), 'Heizungstausch', '36110000-0000-4000-8000-000000000020', null, null, null, null);

-- Refusals write nothing: parts that do not add up, a rate named twice, a
-- fixed amount whose part differs from it, no direction, an unknown scope, a
-- percentage beside a fixed amount, a percentage of a fixed amount's place,
-- and a Titel sum without the Nachlass.
select pg_temp.expect_refusal(label, format('select pg_temp.save(%L, %L, %s)', pg_temp.id('offer'), content, net),
  'invalid_input')
from (values
  ('parts that do not add up', jsonb_set(pg_temp.content(), '{0,positions,5,amountCents}', '-451'), 16049::bigint),
  ('a rate named twice', jsonb_set(pg_temp.content(), '{0,positions,5,taxSplit,1,taxRateBasisPoints}', '1900'), 16050),
  ('a fixed amount with another part', jsonb_set(pg_temp.content(), '{0,positions,6,taxSplit,0,taxRateBasisPoints}', '700'), 16050),
  ('a fixed Zuschlag stored as a Nachlass', jsonb_set(jsonb_set(pg_temp.content(),
    '{0,positions,6,taxSplit,0,amountCents}', '-1500'), '{0,positions,6,amountCents}', '-1500'), 13050),
  ('no direction', pg_temp.content() #- '{0,positions,5,adjustment,direction}', 16050),
  ('an unknown scope', jsonb_set(pg_temp.content(), '{0,positions,5,adjustment,scope}', '"auftrag"'), 16050),
  ('a percentage with a fixed amount', jsonb_set(pg_temp.content(), '{0,positions,5,adjustment,amountCents}', '300'), 16050),
  ('a fixed amount without one', pg_temp.content() #- '{0,positions,6,adjustment,amountCents}', 16050),
  ('no parts', pg_temp.content() #- '{0,positions,5,taxSplit}', 16050),
  ('a Titel sum without the Nachlass', pg_temp.content(16500), 16500)
) as cases(label, content, net);
do $$
begin
  if exists (select 1 from public.offer_positions line
      where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer')) then
    raise exception 'a refused save wrote Positionen';
  end if;
end;
$$;

-- Another organization's admin reaches no offer of this one.
select pg_temp.expect_refusal('a save from another organization', format(
  'select pg_temp.save(%L, %L, 16050, %L, %L)', pg_temp.id('offer'), pg_temp.content(),
  '36110000-0000-4000-8000-000000000011', '36110000-0000-4000-8000-000000000004'), 'offer_not_found');

-- The save stores each Nachlass and Zuschlag with its amount and parts, the
-- Titel sums them with the normal Positionen, and the read answers each as typed.
select pg_temp.save(pg_temp.id('offer'), pg_temp.content());
do $$
declare
  v_read jsonb := public.get_offer('36110000-0000-4000-8000-000000000010', pg_temp.id('offer'));
begin
  if (select array_agg(concat_ws(':', line.position, line.kind, line.price_adjustment, line.price_adjustment_scope,
        line.price_adjustment_percent_hundredths, line.unit_price_cents, line.amount_cents) order by line.position)
      from public.offer_positions line
      where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer')
        and line.kind = 'adjustment')
    is distinct from array['6:adjustment:rabatt:titel:300:-450', '7:adjustment:zuschlag:betrag:1500:1500'] then
    raise exception 'the stored Nachlässe are wrong';
  end if;
  if (select section.net_cents from public.offer_sections section
      where section.organization_id = '36110000-0000-4000-8000-000000000010' and section.offer_id = pg_temp.id('offer'))
    is distinct from 16050::bigint then
    raise exception 'the Titel sum leaves out a Nachlass or Zuschlag';
  end if;
  if v_read #> '{sections,0,positions,5}' is distinct from '{"kind": "adjustment", "name": "Nachlass",
      "description": "Für Stammkunden",
      "adjustment": {"direction": "rabatt", "scope": "titel", "percentHundredths": 300}}'::jsonb
    or v_read #> '{sections,0,positions,6,adjustment}' is distinct from
      '{"direction": "zuschlag", "scope": "betrag", "amountCents": 1500, "taxRateBasisPoints": 1900}'::jsonb then
    raise exception 'the offer reads its Nachlässe as %', v_read -> 'sections';
  end if;
  if jsonb_path_query_array(public.get_offer_with_costs('36110000-0000-4000-8000-000000000010',
      pg_temp.id('offer')), '$.costs[0][5 to 6]') is distinct from '[null, null]'::jsonb then
    raise exception 'a Nachlass reads with a cost';
  end if;
  if public.get_offer('36110000-0000-4000-8000-000000000011', pg_temp.id('offer')) is not null then
    raise exception 'another organization reads the offer';
  end if;
end;
$$;
reset role;

-- The table refuses what the save refuses: a Nachlass without its direction,
-- its parts or a valid percentage, a fixed one without a rate, a text or
-- priced line with a Nachlass's columns.
select pg_temp.expect_refusal(label, format(
  'update public.offer_positions set %s where organization_id = %L and offer_id = %L and position = %s',
  change, '36110000-0000-4000-8000-000000000010', pg_temp.id('offer'), place), '23514')
from (values
  ('a Nachlass without its direction', 'price_adjustment = null', 6),
  ('a Nachlass without parts', 'tax_split = null', 6),
  ('a Nachlass above 100 %', 'price_adjustment_percent_hundredths = 10001', 6),
  ('a percentage with a price', 'unit_price_cents = 300', 6),
  ('a fixed Zuschlag without a rate', 'tax_rate_basis_points = null', 7),
  ('a fixed Zuschlag with a quantity', 'quantity = 1', 7),
  ('a text line with parts', 'tax_split = ''[]''', 5),
  ('a priced line as a Zuschlag', 'price_adjustment = ''zuschlag''', 1)
) as cases(label, change, place);

-- A signed-in session reads no Position, neither the office nor a field worker.
create function pg_temp.positions_read_by(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform pg_temp.expect_refusal('Positionen read', 'select count(*) from public.offer_positions', '42501');
  perform pg_temp.expect_refusal('offer read', format('select public.get_offer(%L, %L)',
    '36110000-0000-4000-8000-000000000010', pg_temp.id('offer')), '42501');
  perform pg_temp.expect_refusal('content save', format(
    'select public.save_offer_content(%L, %L, %L, 2, gen_random_uuid(), %L, %L)', p_user,
    '36110000-0000-4000-8000-000000000010', pg_temp.id('offer'), '[]', '{}'), '42501');
  execute 'reset role';
end;
$$;
select pg_temp.positions_read_by('36110000-0000-4000-8000-000000000002');
select pg_temp.positions_read_by('36110000-0000-4000-8000-000000000003');

-- A build older than Nachlässe and Zuschläge, after a rollback, neither saves
-- this offer, which would drop them, nor files a PDF that did not print them.
set local role service_role;
select pg_temp.expect_refusal(label, format('select pg_temp.save(%L, %L, %s, %L, %L, 2, %L)',
  pg_temp.id('offer'), content, net, '36110000-0000-4000-8000-000000000010',
  '36110000-0000-4000-8000-000000000002', '{"positionTypes": true}'), 'offer_not_editable')
from (values
  ('a save without Nachlässe', jsonb_set(pg_temp.content(15000), '{0,positions}',
    (pg_temp.content() #> '{0,positions}') - 6 - 5), 15000::bigint),
  ('a save that clears every Titel', '[]'::jsonb, 0)
) as cases(label, content, net);
select pg_temp.expect_refusal('a send whose rendering printed no Nachlass', format(
  'select public.send_offer(%L, %L, %L, 1, 2, gen_random_uuid(), %L, %L, %L, %L, %L, %L, %L, %L, 2048, %L)',
  '36110000-0000-4000-8000-000000000002', '36110000-0000-4000-8000-000000000010', pg_temp.id('offer'), 'post',
  (now() at time zone 'Europe/Berlin')::date, 'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin',
  '{"site": null, "positionTypes": true}', '36110000-0000-4000-8000-000000000302',
  '36110000-0000-4000-8000-000000000010/36110000-0000-4000-8000-000000000302/Angebot.pdf', 'Angebot.pdf',
  repeat('b', 64)), 'offer_not_editable');

-- Sending freezes each Nachlass and Zuschlag with its number, adjustment,
-- amount and parts, and no cost.
select public.send_offer('36110000-0000-4000-8000-000000000002', '36110000-0000-4000-8000-000000000010',
  pg_temp.id('offer'), 1, 2, gen_random_uuid(), 'post', (now() at time zone 'Europe/Berlin')::date,
  'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin',
  '{"site": null, "positionTypes": true, "adjustments": true}', '36110000-0000-4000-8000-000000000301',
  '36110000-0000-4000-8000-000000000010/36110000-0000-4000-8000-000000000301/Angebot.pdf', 'Angebot.pdf', 2048,
  repeat('b', 64));
do $$
declare
  v_content jsonb := (select revision.content from public.offer_revisions revision
    where revision.organization_id = '36110000-0000-4000-8000-000000000010' and revision.offer_id = pg_temp.id('offer'));
begin
  if v_content #> '{0,positions,5}' is distinct from '{"number": "1.5", "kind": "adjustment", "name": "Nachlass",
      "description": "Für Stammkunden", "amountCents": -450,
      "adjustment": {"direction": "rabatt", "scope": "titel", "percentHundredths": 300},
      "taxSplit": [{"taxRateBasisPoints": 1900, "amountCents": -300}, {"taxRateBasisPoints": 700, "amountCents": -150}]}'::jsonb
    or v_content #> '{0,positions,6,number}' is distinct from '"1.6"'::jsonb
    or v_content #> '{0,positions,6,adjustment}' is distinct from
      '{"direction": "zuschlag", "scope": "betrag", "amountCents": 1500, "taxRateBasisPoints": 1900}'::jsonb
    or v_content #> '{0,netCents}' is distinct from '16050'::jsonb
    or v_content::text ~* 'cost|margin' then
    raise exception 'the sent revision holds %', v_content;
  end if;
end;
$$;

-- Starting revision 2 keeps every kind of Position as it was: the normal ones,
-- the Bedarfs- and the Alternativposition, the text line, the Nachlass and the
-- Zuschlag, each with its amount, parts and cost.
create temporary table sent_positions as
select to_jsonb(line) - 'id' - 'section_id' as line
from public.offer_positions line
where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer');
select public.start_offer_revision('36110000-0000-4000-8000-000000000002', '36110000-0000-4000-8000-000000000010',
  pg_temp.id('offer'), 2, gen_random_uuid());
do $$
begin
  if (select count(*) from sent_positions) <> 7
    or exists (
      (select line from sent_positions
       except
       select to_jsonb(line) - 'id' - 'section_id' from public.offer_positions line
       where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer'))
      union all
      (select to_jsonb(line) - 'id' - 'section_id' from public.offer_positions line
       where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer')
       except
       select line from sent_positions))
  then
    raise exception 'starting the next revision changed a Position';
  end if;
  if (select array_agg(distinct coalesce(line.price_adjustment, line.position_type, line.kind))
      from public.offer_positions line
      where line.organization_id = '36110000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer'))
    is distinct from array['alternative', 'bedarf', 'normal', 'rabatt', 'zuschlag'] then
    raise exception 'the draft lost a kind of Position';
  end if;
end;
$$;
-- The draft of revision 2 saves again only from a build that knows Nachlässe.
select pg_temp.expect_refusal('an older save of revision 2', format('select pg_temp.save(%L, %L, 16050, %L, %L, 3, %L)',
  pg_temp.id('offer'), pg_temp.content(), '36110000-0000-4000-8000-000000000010',
  '36110000-0000-4000-8000-000000000002', '{"positionTypes": true}'), 'offer_not_editable');
do $$
begin
  if pg_temp.save(pg_temp.id('offer'), pg_temp.content(), 16050, '36110000-0000-4000-8000-000000000010',
      '36110000-0000-4000-8000-000000000002', 3) ->> 'contentVersion' is distinct from '4' then
    raise exception 'revision 2 could not be saved with its Nachlässe';
  end if;
end;
$$;
reset role;

rollback;
