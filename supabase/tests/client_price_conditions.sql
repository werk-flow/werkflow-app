-- A customer's own conditions, kept as versions that never change, price new
-- offer Positions, and each Position keeps where its price came from
-- (migration 20270501110000_price_new_offer_positions_by_customer_conditions.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38440000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'condition-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38440000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'condition-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38440000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'condition-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38440000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'condition-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38440000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH', '38440000-0000-4000-8000-000000000001', 'KONDSQL'),
('38440000-0000-4000-8000-000000000011', 'Fremde Haustechnik GmbH', '38440000-0000-4000-8000-000000000004', 'KONDSQO');
insert into public.organization_members (organization_id, user_id, role) values
('38440000-0000-4000-8000-000000000010', '38440000-0000-4000-8000-000000000002', 'buero'),
('38440000-0000-4000-8000-000000000010', '38440000-0000-4000-8000-000000000003', 'employee');

-- 20: the customer, 21: another customer, 22: archived, 23: no offer, 29: another organization's.
insert into public.clients (id, organization_id, name, client_type, address, archived_at) values
('38440000-0000-4000-8000-000000000020', '38440000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin', null),
('38440000-0000-4000-8000-000000000021', '38440000-0000-4000-8000-000000000010',
 'Erika Musterfrau', 'privat', 'Lindenstraße 5, 10115 Berlin', null),
('38440000-0000-4000-8000-000000000022', '38440000-0000-4000-8000-000000000010',
 'Alte Kundin', 'privat', null, now()),
('38440000-0000-4000-8000-000000000023', '38440000-0000-4000-8000-000000000010',
 'Versehentlich angelegt', 'privat', null, null),
('38440000-0000-4000-8000-000000000029', '38440000-0000-4000-8000-000000000011',
 'Fremde Kundin', 'privat', null, null);
-- 80: the organization's Leistung, 89: another organization's.
insert into public.leistungen (id, organization_id, leistung_number, name, kind, unit, tax_rate_basis_points) values
('38440000-0000-4000-8000-000000000080', '38440000-0000-4000-8000-000000000010', 'L-7', 'Monteurstunde',
 'arbeit', 'hour', 1900),
('38440000-0000-4000-8000-000000000089', '38440000-0000-4000-8000-000000000011', 'L-1', 'Fremde Stunde',
 'arbeit', 'hour', 1900);

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

-- Grants: no client role writes a condition, reads an own price or runs a function; a signed-in
-- role may only select a version row, which RLS limits to Admin and Büro.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.client_price_conditions', 'INSERT')
      or has_table_privilege(v_role, 'public.client_price_conditions', 'UPDATE')
      or has_table_privilege(v_role, 'public.client_price_conditions', 'DELETE')
      or has_table_privilege(v_role, 'public.client_price_condition_leistungen', 'SELECT')
      or has_table_privilege(v_role, 'public.client_price_condition_leistungen', 'INSERT') then
      raise exception '% holds a write or own price privilege on conditions', v_role;
    end if;
    if has_function_privilege(v_role,
        'public.record_client_price_condition(uuid,uuid,uuid,integer,uuid,date,integer,integer,integer,jsonb)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_client_price_conditions(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.save_offer_content(uuid,uuid,uuid,integer,uuid,jsonb,jsonb)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.get_offer_with_costs(uuid,uuid)', 'EXECUTE') then
      raise exception '% can execute a condition function', v_role;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.client_price_conditions', 'SELECT') then
    raise exception 'anon can select conditions';
  end if;
  if has_table_privilege('service_role', 'public.client_price_conditions', 'UPDATE')
    or has_table_privilege('service_role', 'public.client_price_conditions', 'DELETE')
    or has_table_privilege('service_role', 'public.client_price_condition_leistungen', 'UPDATE')
    or has_table_privilege('service_role', 'public.client_price_condition_leistungen', 'DELETE') then
    raise exception 'service_role can rewrite a condition';
  end if;
  if exists (select 1 from pg_class
      where oid in ('public.client_price_conditions'::regclass, 'public.client_price_condition_leistungen'::regclass)
        and not relrowsecurity) then
    raise exception 'a condition table runs without RLS';
  end if;
end;
$$;

set local role service_role;
create function pg_temp.record(
  p_actor uuid, p_client uuid, p_expected integer, p_key uuid, p_valid_from date, p_material integer,
  p_prices jsonb
) returns jsonb language sql as $$
  select public.record_client_price_condition(p_actor, '38440000-0000-4000-8000-000000000010', p_client,
    p_expected, p_key, p_valid_from, p_material, 50, 0, p_prices);
$$;

-- Büro records the first version with its own price, and a repeat under the same key answers it.
do $$
declare
  v_first jsonb;
  v_condition public.client_price_conditions;
begin
  v_first := pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000020', 0,
    '38440000-0000-4000-8000-000000000101', '2037-01-01', 100,
    '[{"leistungId": "38440000-0000-4000-8000-000000000080", "salePriceCents": 6800}]');
  if (v_first ->> 'version')::integer is distinct from 1 then
    raise exception 'the first version is %', v_first;
  end if;
  select * into v_condition from public.client_price_conditions where id = (v_first ->> 'conditionId')::uuid;
  if v_condition.client_id is distinct from '38440000-0000-4000-8000-000000000020'::uuid
    or v_condition.valid_from is distinct from '2037-01-01'::date
    or v_condition.material_discount_tenths is distinct from 100
    or v_condition.arbeit_discount_tenths is distinct from 50
    or v_condition.anfahrt_discount_tenths is distinct from 0
    or v_condition.created_by is distinct from '38440000-0000-4000-8000-000000000002'::uuid then
    raise exception 'the first version stored %', to_jsonb(v_condition);
  end if;
  if (select array_agg(leistung_id::text || ':' || sale_price_cents) from public.client_price_condition_leistungen
      where condition_id = v_condition.id) is distinct from array['38440000-0000-4000-8000-000000000080:6800'] then
    raise exception 'the first version kept other own prices';
  end if;
  if pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000020', 0,
      '38440000-0000-4000-8000-000000000101', '2037-01-01', 100, '[]') is distinct from v_first then
    raise exception 'a repeat under the same key did not answer the first version';
  end if;
  if (select count(*) from public.client_price_conditions
      where client_id = '38440000-0000-4000-8000-000000000020') <> 1 then
    raise exception 'a repeat recorded a second version';
  end if;
end;
$$;

-- Another session's version meanwhile refuses an older form; the next one counts on.
select pg_temp.expect_refusal('a stale form', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000020', 0,
    gen_random_uuid(), '2037-02-01', 120, '[]')
$sql$, 'condition_changed');
do $$
begin
  if (pg_temp.record('38440000-0000-4000-8000-000000000001', '38440000-0000-4000-8000-000000000020', 1,
      '38440000-0000-4000-8000-000000000102', '2037-03-01', 150, '[]') ->> 'version')::integer is distinct from 2 then
    raise exception 'the second version is not number 2';
  end if;
end;
$$;

-- Another organization's customer and Leistung, a field worker, an outsider and an archived
-- customer are refused; a key reused for another customer is no repeat.
select pg_temp.expect_refusal('a foreign customer', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000029', 0,
    gen_random_uuid(), '2037-01-01', 100, '[]')
$sql$, 'client_not_found');
select pg_temp.expect_refusal('a foreign Leistung', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000021', 0,
    gen_random_uuid(), '2037-01-01', 100,
    '[{"leistungId": "38440000-0000-4000-8000-000000000089", "salePriceCents": 6800}]')
$sql$, 'leistung_not_found');
select pg_temp.expect_refusal('a field worker', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000003', '38440000-0000-4000-8000-000000000021', 0,
    gen_random_uuid(), '2037-01-01', 100, '[]')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('an outsider', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000004', '38440000-0000-4000-8000-000000000021', 0,
    gen_random_uuid(), '2037-01-01', 100, '[]')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('an archived customer', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000022', 0,
    gen_random_uuid(), '2037-01-01', 100, '[]')
$sql$, 'client_archived');
select pg_temp.expect_refusal('a key of another customer', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000021', 0,
    '38440000-0000-4000-8000-000000000101', '2037-01-01', 100, '[]')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('one Leistung twice', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000021', 0,
    gen_random_uuid(), '2037-01-01', 100,
    '[{"leistungId": "38440000-0000-4000-8000-000000000080", "salePriceCents": 6800},
      {"leistungId": "38440000-0000-4000-8000-000000000080", "salePriceCents": 6900}]')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a discount above 100 %', $sql$
  select pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000021', 0,
    gen_random_uuid(), '2037-01-01', 1001, '[]')
$sql$, '23514');

-- The list answers the organization's customer's versions, the newest first, with each own
-- price's Leistung; another organization's customer answers none.
do $$
declare
  v_list jsonb := public.list_client_price_conditions('38440000-0000-4000-8000-000000000010',
    '38440000-0000-4000-8000-000000000020');
begin
  if jsonb_array_length(v_list) is distinct from 2 or (v_list -> 0 ->> 'version')::integer is distinct from 2
    or (v_list -> 1 ->> 'materialDiscountTenths')::integer is distinct from 100
    or v_list -> 1 -> 'leistungPrices' -> 0 ->> 'number' is distinct from 'L-7'
    or (v_list -> 1 -> 'leistungPrices' -> 0 ->> 'salePriceCents')::integer is distinct from 6800 then
    raise exception 'the list answered %', v_list;
  end if;
  if public.list_client_price_conditions('38440000-0000-4000-8000-000000000010',
      '38440000-0000-4000-8000-000000000029') is distinct from '[]'::jsonb then
    raise exception 'another organization''s customer answered conditions';
  end if;
end;
$$;

-- A version and its own prices never change and are never deleted: the server holds no grant to,
-- and the history guard refuses even the owner.
select pg_temp.expect_refusal('a changed version by the server',
  'update public.client_price_conditions set material_discount_tenths = 0', '42501');
select pg_temp.expect_refusal('a deleted own price by the server',
  'delete from public.client_price_condition_leistungen', '42501');
reset role;
select pg_temp.expect_refusal('a changed version',
  'update public.client_price_conditions set valid_from = ''2020-01-01''', 'client_price_condition_is_immutable');
select pg_temp.expect_refusal('a deleted version',
  'delete from public.client_price_conditions', 'client_price_condition_is_immutable');
select pg_temp.expect_refusal('a changed own price',
  'update public.client_price_condition_leistungen set sale_price_cents = 1', 'client_price_condition_is_immutable');
select pg_temp.expect_refusal('a deleted own price',
  'delete from public.client_price_condition_leistungen', 'client_price_condition_is_immutable');

-- Admin and Büro read their organization's version rows, to hear of a new one; a field worker
-- and another organization read none, and no signed-in role reads an own price.
create function pg_temp.versions_read_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.client_price_conditions;
  perform pg_temp.expect_refusal('own price read', 'select count(*) from public.client_price_condition_leistungen',
    '42501');
  perform pg_temp.expect_refusal('condition list',
    format('select public.list_client_price_conditions(%L, %L)', '38440000-0000-4000-8000-000000000010',
      '38440000-0000-4000-8000-000000000020'), '42501');
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.versions_read_by('38440000-0000-4000-8000-000000000002') is distinct from 2
    or pg_temp.versions_read_by('38440000-0000-4000-8000-000000000001') is distinct from 2 then
    raise exception 'Admin or Büro do not read their versions';
  end if;
  if pg_temp.versions_read_by('38440000-0000-4000-8000-000000000003') is distinct from 0 then
    raise exception 'a field worker reads a condition';
  end if;
  if pg_temp.versions_read_by('38440000-0000-4000-8000-000000000004') is distinct from 0 then
    raise exception 'another organization reads a condition';
  end if;
end;
$$;

-- An offer of the customer and one of another customer.
set local role service_role;
select public.create_offer('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000010',
  '38440000-0000-4000-8000-000000000201', 'Wartung Lindenhof', '38440000-0000-4000-8000-000000000020',
  null, null, null, null);
select public.create_offer('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000010',
  '38440000-0000-4000-8000-000000000202', 'Bad Musterfrau', '38440000-0000-4000-8000-000000000021',
  null, null, null, null);
create temp table ids on commit drop as
select
  (select id from public.offers where client_id = '38440000-0000-4000-8000-000000000020') as own_offer,
  (select id from public.offers where client_id = '38440000-0000-4000-8000-000000000021') as other_offer,
  (select id from public.client_price_conditions where client_id = '38440000-0000-4000-8000-000000000020'
    and version = 2) as condition;
grant select on ids to service_role;

-- One Monteurstunde at the customer's price, one at the list price, one typed by hand.
create function pg_temp.content(p_condition uuid) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('title', 'Montage', 'netCents', 20300, 'positions', jsonb_build_array(
    jsonb_build_object('kind', 'free', 'name', 'Monteurstunde', 'description', '', 'quantity', '1', 'unit', 'hour',
      'unitLabel', 'Std', 'unitPriceCents', 6800, 'priceQuantity', 1, 'taxRateBasisPoints', 1900,
      'amountCents', 6800, 'source', jsonb_build_object('kind', 'leistung',
        'id', '38440000-0000-4000-8000-000000000080'),
      'priceSource', jsonb_build_object('kind', 'kundenkondition', 'conditionId', p_condition)),
    jsonb_build_object('kind', 'free', 'name', 'Monteurstunde', 'description', '', 'quantity', '1', 'unit', 'hour',
      'unitLabel', 'Std', 'unitPriceCents', 7250, 'priceQuantity', 1, 'taxRateBasisPoints', 1900,
      'amountCents', 7250, 'source', jsonb_build_object('kind', 'leistung',
        'id', '38440000-0000-4000-8000-000000000080'),
      'priceSource', jsonb_build_object('kind', 'listenpreis', 'conditionId', null)),
    jsonb_build_object('kind', 'free', 'name', 'Kleinmaterial', 'description', '', 'quantity', '1', 'unit', 'flat_rate',
      'unitLabel', 'psch', 'unitPriceCents', 6250, 'priceQuantity', 1, 'taxRateBasisPoints', 1900,
      'amountCents', 6250, 'source', null, 'priceSource', jsonb_build_object('kind', 'manuell')))));
$$;
create function pg_temp.save(p_offer uuid, p_sections jsonb) returns jsonb language sql as $$
  select public.save_offer_content('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000010',
    p_offer, 1, gen_random_uuid(), p_sections, '{"netCents": 20300, "taxCents": 3857, "grossCents": 24157}');
$$;

-- A condition of another customer is refused for this offer, and so is one of another
-- organization, a customer condition without a version and a list price without a catalog entry.
select pg_temp.expect_refusal('a condition of another customer',
  format('select pg_temp.save(%L, pg_temp.content(%L))', (select other_offer from ids), (select condition from ids)),
  'price_condition_not_found');
select pg_temp.expect_refusal('an unknown condition',
  format('select pg_temp.save(%L, pg_temp.content(%L))', (select own_offer from ids), gen_random_uuid()),
  'price_condition_not_found');
select pg_temp.expect_refusal('a customer condition without a version',
  format('select pg_temp.save(%L, jsonb_set(pg_temp.content(null), %L, %L))', (select own_offer from ids),
    '{0,positions,0,priceSource}', '{"kind": "kundenkondition"}'),
  'invalid_input');
select pg_temp.expect_refusal('a list price with a version',
  format('select pg_temp.save(%L, jsonb_set(pg_temp.content(%L), %L, %L))', (select own_offer from ids),
    (select condition from ids), '{0,positions,1,priceSource,conditionId}', to_jsonb((select condition from ids))),
  'invalid_input');
select pg_temp.expect_refusal('a list price without a catalog entry',
  format('select pg_temp.save(%L, jsonb_set(pg_temp.content(%L), %L, %L))', (select own_offer from ids),
    (select condition from ids), '{0,positions,2,priceSource}', '{"kind": "listenpreis"}'),
  '23514');

-- The offer's customer's version is stored with each Position, and the office's read answers
-- each source, the version with its number and first day; the document read answers none.
do $$
declare
  v_read jsonb;
begin
  perform pg_temp.save((select own_offer from ids), pg_temp.content((select condition from ids)));
  if (select array_agg(coalesce(price_source, '-') || ':' || coalesce(price_condition_id::text, '-')
        order by position)
      from public.offer_positions where offer_id = (select own_offer from ids))
    is distinct from array['kundenkondition:' || (select condition from ids), 'listenpreis:-', 'manuell:-'] then
    raise exception 'the Positions stored other sources';
  end if;
  v_read := public.get_offer_with_costs('38440000-0000-4000-8000-000000000010', (select own_offer from ids));
  if v_read -> 'priceSources' is distinct from jsonb_build_array(jsonb_build_array(
      jsonb_build_object('kind', 'kundenkondition', 'condition', jsonb_build_object(
        'id', (select condition from ids), 'version', 2, 'validFrom', '2037-03-01')),
      jsonb_build_object('kind', 'listenpreis', 'condition', null),
      jsonb_build_object('kind', 'manuell', 'condition', null))) then
    raise exception 'the office read answered %', v_read -> 'priceSources';
  end if;
  if public.get_offer('38440000-0000-4000-8000-000000000010', (select own_offer from ids))::text
      like '%kundenkondition%' then
    raise exception 'the document read carries a price source';
  end if;
end;
$$;

-- A new version changes no stored Position.
do $$
begin
  perform pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000020', 2,
    gen_random_uuid(), '2037-03-01', 0, '[]');
  if (select price_condition_id from public.offer_positions
      where offer_id = (select own_offer from ids) and position = 1) is distinct from (select condition from ids) then
    raise exception 'a new version changed a Position';
  end if;
end;
$$;

-- A customer deleted as a mistaken entry takes its conditions with it.
do $$
begin
  perform pg_temp.record('38440000-0000-4000-8000-000000000002', '38440000-0000-4000-8000-000000000023', 0,
    gen_random_uuid(), '2037-01-01', 100,
    '[{"leistungId": "38440000-0000-4000-8000-000000000080", "salePriceCents": 6500}]');
end;
$$;
reset role;
delete from public.clients where id = '38440000-0000-4000-8000-000000000023';
do $$
begin
  if exists (select 1 from public.client_price_conditions where client_id = '38440000-0000-4000-8000-000000000023') then
    raise exception 'a deleted customer kept its conditions';
  end if;
end;
$$;

rollback;
