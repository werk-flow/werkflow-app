-- An offer Position can be a Bedarfsposition or an Alternativposition to a
-- normal Position of its Titel; neither counts in a sum, and a sent revision
-- keeps both without a cost; a saved price source names a condition of its
-- organization (migration 20270701100000_keep_bedarfs_and_alternativpositionen_out_of_an_offer_total.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38580000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'type-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38580000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'type-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38580000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'type-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38580000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'type-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38580000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Positionsarten', '38580000-0000-4000-8000-000000000001', 'OFFTYPE'),
('38580000-0000-4000-8000-000000000011', 'Fremde Haustechnik Positionsarten', '38580000-0000-4000-8000-000000000004', 'OFFTYPO');
insert into public.organization_members (organization_id, user_id, role) values
('38580000-0000-4000-8000-000000000010', '38580000-0000-4000-8000-000000000002', 'buero'),
('38580000-0000-4000-8000-000000000010', '38580000-0000-4000-8000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, client_type, address) values
('38580000-0000-4000-8000-000000000020', '38580000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');

-- A Leistung of the organization, which a Position priced by a customer condition names.
insert into public.leistungen (id, organization_id, leistung_number, name, kind, unit, tax_rate_basis_points)
values ('38580000-0000-4000-8000-000000000060', '38580000-0000-4000-8000-000000000010', 'L-58',
  'Inbetriebnahme Wandgerät', 'pauschale', 'flat_rate', 1900);

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

-- A priced Position of `p_type` (null for none) at p_cents, with the office's cost.
create function pg_temp.priced(p_name text, p_cents integer, p_type jsonb) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('kind', 'free', 'name', p_name, 'description', '',
    'quantity', '1', 'unit', 'piece', 'unitLabel', 'Stk.', 'unitPriceCents', p_cents, 'priceQuantity', 1,
    'taxRateBasisPoints', 1900, 'amountCents', p_cents,
    'purchaseCost', jsonb_build_object('amountCents', 1000, 'priceQuantity', 1), 'positionType', p_type));
$$;
grant execute on function pg_temp.priced(text, integer, jsonb) to service_role;

-- One Titel: 1.1 the boiler (normal), a text line, 1.2 a Neutralisationsbox if needed,
-- 1.3 a smaller boiler instead of 1.1. The Titel sums 4.890,00 € only.
create function pg_temp.content(p_net bigint default 489000) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('title', 'Wärmeerzeuger', 'netCents', p_net, 'positions',
    jsonb_build_array(
      pg_temp.priced('Gas-Brennwerttherme 25 kW', 489000, '{"kind": "normal"}'),
      '{"kind": "text", "name": "Hinweis", "description": ""}'::jsonb,
      pg_temp.priced('Neutralisationsbox', 18500, '{"kind": "bedarf"}'),
      pg_temp.priced('Gas-Brennwerttherme 20 kW', 452000, '{"kind": "alternative", "alternativeTo": 1}'))));
$$;
grant execute on function pg_temp.content(bigint) to service_role;

create function pg_temp.save(p_offer uuid, p_content jsonb, p_net bigint default 489000,
  p_organization uuid default '38580000-0000-4000-8000-000000000010',
  p_actor uuid default '38580000-0000-4000-8000-000000000002', p_version integer default 1,
  p_legacy boolean default false)
  returns jsonb language sql as $$
  select public.save_offer_content(p_actor, p_organization, p_offer, p_version,
    gen_random_uuid(), p_content, jsonb_build_object('netCents', p_net, 'taxCents', 92910, 'grossCents', 581910)
      || case when p_legacy then '{}'::jsonb else '{"positionTypes": true}'::jsonb end);
$$;
grant execute on function pg_temp.save(uuid, jsonb, bigint, uuid, uuid, integer, boolean) to service_role;

-- K8's foreign key from a Position to its customer condition is validated.
do $$
begin
  if (select constraint_row.convalidated from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.offer_positions'::regclass
        and constraint_row.conname = 'offer_positions_price_condition_fk') is distinct from true then
    raise exception 'the price condition foreign key of offer_positions is not validated';
  end if;
  -- No client role holds a privilege on a Position's type: the server reads it.
  if has_column_privilege('authenticated', 'public.offer_positions', 'position_type', 'SELECT')
    or has_column_privilege('authenticated', 'public.offer_positions', 'alternative_to', 'SELECT')
    or has_column_privilege('anon', 'public.offer_positions', 'position_type', 'SELECT') then
    raise exception 'a client role reads a Position''s type';
  end if;
end;
$$;

set local role service_role;
insert into ids
select 'offer', public.create_offer('38580000-0000-4000-8000-000000000002', '38580000-0000-4000-8000-000000000010',
  gen_random_uuid(), 'Heizungstausch', '38580000-0000-4000-8000-000000000020', null, null, null, null);

-- Refusals write nothing: an Alternativposition naming the text line, the
-- Bedarfsposition, itself, no line of the Titel or no place; a type on a text
-- line; an unknown type; and a Titel sum that counts the Bedarfsposition.
select pg_temp.expect_refusal(label, format('select pg_temp.save(%L, %L, %s)', pg_temp.id('offer'), content, net),
  'invalid_input')
from (values
  ('alternative to a text line', jsonb_set(pg_temp.content(), '{0,positions,3,positionType,alternativeTo}', '2'), 489000),
  ('alternative to a Bedarfsposition', jsonb_set(pg_temp.content(), '{0,positions,3,positionType,alternativeTo}', '3'), 489000),
  ('alternative to itself', jsonb_set(pg_temp.content(), '{0,positions,3,positionType,alternativeTo}', '4'), 489000),
  ('alternative to no line', jsonb_set(pg_temp.content(), '{0,positions,3,positionType,alternativeTo}', '5'), 489000),
  ('alternative without a place', jsonb_set(pg_temp.content(), '{0,positions,3,positionType}', '{"kind": "alternative"}'), 489000),
  ('a text line with a type', jsonb_set(pg_temp.content(), '{0,positions,1,positionType}', '{"kind": "bedarf"}'), 489000),
  ('an unknown type', jsonb_set(pg_temp.content(), '{0,positions,2,positionType}', '{"kind": "optional"}'), 489000),
  ('a sum with the Bedarfsposition', pg_temp.content(507500), 507500::bigint)
) as cases(label, content, net);
do $$
begin
  if exists (select 1 from public.offer_positions line
      where line.organization_id = '38580000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer')) then
    raise exception 'a refused save wrote Positionen';
  end if;
end;
$$;

-- Another organization's admin reaches no offer of this one.
select pg_temp.expect_refusal('a save from another organization', format(
  'select pg_temp.save(%L, %L, 489000, %L, %L)', pg_temp.id('offer'), pg_temp.content(),
  '38580000-0000-4000-8000-000000000011', '38580000-0000-4000-8000-000000000004'), 'offer_not_found');

-- The save stores each type, the Titel sums the normal Position only, and the
-- reads answer the type beside a Bedarfs- or Alternativposition only.
select pg_temp.save(pg_temp.id('offer'), pg_temp.content());
do $$
declare
  v_read jsonb := public.get_offer('38580000-0000-4000-8000-000000000010', pg_temp.id('offer'));
begin
  if (select array_agg(line.position || ':' || line.position_type || ':' || coalesce(line.alternative_to::text, '-')
        order by line.position)
      from public.offer_positions line
      where line.organization_id = '38580000-0000-4000-8000-000000000010' and line.offer_id = pg_temp.id('offer'))
    is distinct from array['1:normal:-', '2:normal:-', '3:bedarf:-', '4:alternative:1'] then
    raise exception 'the stored types are wrong';
  end if;
  if (select section.net_cents from public.offer_sections section
      where section.organization_id = '38580000-0000-4000-8000-000000000010' and section.offer_id = pg_temp.id('offer'))
    is distinct from 489000::bigint then
    raise exception 'the Titel sum counts a Bedarfs- or Alternativposition';
  end if;
  if jsonb_path_query_array(v_read, '$.sections[0].positions[*].positionType') is distinct from
      '[{"kind": "bedarf"}, {"kind": "alternative", "alternativeTo": 1}]'::jsonb then
    raise exception 'the offer reads its types as %', v_read -> 'sections';
  end if;
  if jsonb_path_query_array(public.get_offer_with_costs('38580000-0000-4000-8000-000000000010',
      pg_temp.id('offer')), '$.costs[0][*].amountCents') is distinct from '[1000, 1000, 1000]'::jsonb then
    raise exception 'the office read lost the cost of a Bedarfs- or Alternativposition';
  end if;
  if public.get_offer('38580000-0000-4000-8000-000000000011', pg_temp.id('offer')) is not null then
    raise exception 'another organization reads the offer';
  end if;
end;
$$;
reset role;

-- The table refuses what the save refuses: a type on a text line, an
-- Alternativposition without its Position, and one naming no line of its Titel.
select pg_temp.expect_refusal(label, format(
  'update public.offer_positions set position_type = %L, alternative_to = %s
   where organization_id = %L and offer_id = %L and position = %s',
  position_type, alternative_to, '38580000-0000-4000-8000-000000000010', pg_temp.id('offer'), place), refusal)
from (values
  ('a text line as Bedarfsposition', 'bedarf', 'null', 2, '23514'),
  ('an Alternativposition without its Position', 'alternative', 'null', 3, '23514'),
  ('an Alternativposition to no line', 'alternative', '9', 3, '23503')
) as cases(label, position_type, alternative_to, place, refusal);

-- A saved price source names a condition of the Position's organization: the
-- validated key refuses a dangling one on a Position from a Leistung.
select pg_temp.expect_refusal('a dangling price condition', format(
  'update public.offer_positions set leistung_id = %L, price_source = %L, price_condition_id = %L
   where organization_id = %L and offer_id = %L and position = 1',
  '38580000-0000-4000-8000-000000000060', 'kundenkondition', '38580000-0000-4000-8000-000000000099', '38580000-0000-4000-8000-000000000010',
  pg_temp.id('offer')), '23503');

-- A signed-in session reads no Position, neither the office nor a field worker.
create function pg_temp.positions_read_by(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform pg_temp.expect_refusal('Positionen read', 'select count(*) from public.offer_positions', '42501');
  perform pg_temp.expect_refusal('offer read', format('select public.get_offer(%L, %L)',
    '38580000-0000-4000-8000-000000000010', pg_temp.id('offer')), '42501');
  execute 'reset role';
end;
$$;
select pg_temp.positions_read_by('38580000-0000-4000-8000-000000000002');
select pg_temp.positions_read_by('38580000-0000-4000-8000-000000000003');

-- A build older than the types, after a rollback, neither saves a Bedarfs- or
-- Alternativposition as a normal one nor files a PDF that counted it: both
-- calls are refused for this offer. Its untyped offers save and send as
-- before (offers.sql, offer_sending.sql).
set local role service_role;
select pg_temp.expect_refusal(label, format('select pg_temp.save(%L, %L, %s, %L, %L, 2, true)',
  pg_temp.id('offer'), content, net, '38580000-0000-4000-8000-000000000010',
  '38580000-0000-4000-8000-000000000002'), 'offer_not_editable')
from (values
  ('a save without types', pg_temp.content() #- '{0,positions,0,positionType}'
    #- '{0,positions,2,positionType}' #- '{0,positions,3,positionType}', 489000),
  ('a save that clears every Titel', '[]'::jsonb, 0)
) as cases(label, content, net);
-- A caller that knows the types may clear the offer.
savepoint typed_clear;
do $$
begin
  if pg_temp.save(pg_temp.id('offer'), '[]', 0, '38580000-0000-4000-8000-000000000010',
      '38580000-0000-4000-8000-000000000002', 2) ->> 'contentVersion' is distinct from '3' then
    raise exception 'a type-aware save could not clear the offer';
  end if;
end;
$$;
rollback to savepoint typed_clear;
select pg_temp.expect_refusal('a send whose rendering counted every Position', format(
  'select public.send_offer(%L, %L, %L, 1, 2, gen_random_uuid(), %L, %L, %L, %L, %L, %L, %L, %L, 2048, %L)',
  '38580000-0000-4000-8000-000000000002', '38580000-0000-4000-8000-000000000010', pg_temp.id('offer'), 'post',
  (now() at time zone 'Europe/Berlin')::date, 'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin',
  '{"site": null}', '38580000-0000-4000-8000-000000000302',
  '38580000-0000-4000-8000-000000000010/38580000-0000-4000-8000-000000000302/Angebot.pdf', 'Angebot.pdf',
  repeat('b', 64)), 'offer_not_editable');

-- Sending freezes each type, an Alternativposition's Position by its printed
-- number, and no cost.
select public.send_offer('38580000-0000-4000-8000-000000000002', '38580000-0000-4000-8000-000000000010',
  pg_temp.id('offer'), 1, 2, gen_random_uuid(), 'post', (now() at time zone 'Europe/Berlin')::date,
  'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin', '{"site": null, "positionTypes": true}',
  '38580000-0000-4000-8000-000000000301',
  '38580000-0000-4000-8000-000000000010/38580000-0000-4000-8000-000000000301/Angebot.pdf', 'Angebot.pdf', 2048,
  repeat('b', 64));
do $$
declare
  v_content jsonb := (select revision.content from public.offer_revisions revision
    where revision.organization_id = '38580000-0000-4000-8000-000000000010' and revision.offer_id = pg_temp.id('offer'));
begin
  if jsonb_path_query_array(v_content, '$[0].positions[*] ? (@.kind == "free").number') is distinct from
      '["1.1", "1.2", "1.3"]'::jsonb
    or v_content #> '{0,positions,0,positionType}' is not null
    or v_content #> '{0,positions,2,positionType}' is distinct from '"bedarf"'::jsonb
    or v_content #> '{0,positions,3,positionType}' is distinct from '"alternative"'::jsonb
    or v_content #> '{0,positions,3,alternativeTo}' is distinct from '"1.1"'::jsonb
    or v_content #> '{0,positions,3,amountCents}' is distinct from '452000'::jsonb
    or v_content #> '{0,netCents}' is distinct from '489000'::jsonb
    or v_content::text ~* 'cost|margin' then
    raise exception 'the sent revision holds %', v_content;
  end if;
end;
$$;
reset role;

rollback;
