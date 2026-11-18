-- Imported prices reach the own articles only as dated prices, with the
-- office's rebate per rebate group, after a preview of each change
-- (werk-flow/werkflow-planning#477, migration
-- 20261217090000_carry_imported_prices_to_own_articles.sql).
-- Made-up organizations, wholesalers and articles only.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('47700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'prices-admin@example.test', '', now(), '{}', '{}', now(), now()),
('47700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'prices-buero@example.test', '', now(), '{}', '{}', now(), now()),
('47700000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'prices-employee@example.test', '', now(), '{}', '{}', now(), now()),
('47700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'prices-outsider@example.test', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('47700000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '47700000-0000-4000-8000-000000000001', 'PRICES01'),
('47700000-0000-4000-8000-000000000011', 'Fremde Haustechnik',
 '47700000-0000-4000-8000-000000000004', 'PRICES02');
insert into public.organization_members (organization_id, user_id, role) values
('47700000-0000-4000-8000-000000000010', '47700000-0000-4000-8000-000000000002', 'buero'),
('47700000-0000-4000-8000-000000000010', '47700000-0000-4000-8000-000000000003', 'employee');

-- 30 Nordrohr and 31 Westrohr are ours.
insert into public.inventory_suppliers (id, organization_id, name) values
('47700000-0000-4000-8000-000000000030', '47700000-0000-4000-8000-000000000010', 'Großhandel Nordrohr'),
('47700000-0000-4000-8000-000000000031', '47700000-0000-4000-8000-000000000010', 'Großhandel Westrohr');

-- 21 pipe (Nordrohr preferred), 22 fitting (Westrohr preferred, Nordrohr
-- second), 23 valve (Nordrohr, net price), 24 sleeve in Stück that Nordrohr
-- delivers in Meter, 25 bend whose list price is already its sale price,
-- 26 a CSV article with an Artikelnummer.
insert into public.inventory_items (id, organization_id, name, item_type, unit, internal_sku) values
('47700000-0000-4000-8000-000000000021', '47700000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm', 'material', 'meter', null),
('47700000-0000-4000-8000-000000000022', '47700000-0000-4000-8000-000000000010', 'Pressfitting 15 mm', 'material', 'piece', null),
('47700000-0000-4000-8000-000000000023', '47700000-0000-4000-8000-000000000010', 'Kugelhahn 1/2"', 'material', 'piece', null),
('47700000-0000-4000-8000-000000000024', '47700000-0000-4000-8000-000000000010', 'Muffe 15 mm', 'material', 'piece', null),
('47700000-0000-4000-8000-000000000025', '47700000-0000-4000-8000-000000000010', 'Bogen 15 mm', 'material', 'piece', null),
('47700000-0000-4000-8000-000000000026', '47700000-0000-4000-8000-000000000010', 'Rohrschelle 15 mm', 'material', 'piece', 'SB-100');

do $$
declare
  v_org constant uuid := '47700000-0000-4000-8000-000000000010';
  v_buero constant uuid := '47700000-0000-4000-8000-000000000002';
  v_nord constant uuid := '47700000-0000-4000-8000-000000000030';
  v_west constant uuid := '47700000-0000-4000-8000-000000000031';
begin
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000021', 'meter',
    null, v_nord, null, 'NR-1501', null, 1, 1, true);
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000022', 'piece',
    null, v_west, null, 'WR-1502', null, 1, 1, true);
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000022', 'piece',
    null, v_nord, null, 'NR-1502', null, 1, 1, false);
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000023', 'piece',
    null, v_nord, null, 'NR-1503', null, 1, 1, true);
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000024', 'piece',
    null, v_nord, null, 'NR-1504', null, 1, 1, true);
  perform public.save_inventory_item_supplier(v_org, v_buero, '47700000-0000-4000-8000-000000000025', 'piece',
    null, v_nord, null, 'NR-1505', null, 1, 1, true);
  perform public.add_inventory_item_price(v_org, v_buero, '47700000-0000-4000-8000-000000000021', 'meter',
    'purchase', 400, 1, '2026-01-01');
  perform public.add_inventory_item_price(v_org, v_buero, '47700000-0000-4000-8000-000000000021', 'meter',
    'sale', 500, 1, '2026-01-01');
  perform public.add_inventory_item_price(v_org, v_buero, '47700000-0000-4000-8000-000000000022', 'piece',
    'sale', 100, 1, '2026-01-01');
  perform public.add_inventory_item_price(v_org, v_buero, '47700000-0000-4000-8000-000000000025', 'piece',
    'sale', 7000, 10, '2026-01-01');
  perform public.add_inventory_item_price(v_org, v_buero, '47700000-0000-4000-8000-000000000026', 'piece',
    'purchase', 300, 1, '2026-01-01');
end;
$$;

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % (%) instead of %', p_label, sqlerrm, sqlstate, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- One staged article line as the server sends it.
create function pg_temp.article(
  p_ordinal integer, p_number text, p_unit text, p_kind text, p_cents integer, p_quantity integer, p_group text
) returns jsonb language sql as $$
  select jsonb_build_object(
    'ordinal', p_ordinal, 'kind', 'article', 'file_name', 'lieferung-nordrohr', 'line_number', p_ordinal + 1,
    'article_number', p_number, 'name', 'Artikel ' || p_number, 'name_addition', '', 'unit_text', p_unit,
    'price_quantity', p_quantity, 'price_kind', p_kind, 'price_cents', p_cents, 'rebate_group', p_group
  );
$$;
grant execute on function pg_temp.article(integer, text, text, text, integer, integer, text) to service_role;

-- Opens, stages and previews one delivery of Nordrohr by Büro; answers the batch.
create function pg_temp.previewed_delivery(p_hash text, p_lines jsonb) returns uuid
language plpgsql as $$
declare
  v_import uuid;
begin
  v_import := public.open_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', '47700000-0000-4000-8000-000000000030',
    array['lieferung-nordrohr'], p_hash,
    -- A delivery dated in the past never rewrites a past day.
    '{"format_version":"4","supplier_text":"Großhandel Nordrohr","date":"2020-01-01","currency":"EUR"}',
    '[{"rebate_group":"CU1","text":"Kupfer","discount":{"kind":"percent","hundredthsOfPercent":3000}},
      {"rebate_group":"AR1","text":"Armaturen","discount":{"kind":"unread","code":"X","value":"?"}}]',
    '[]');
  perform public.stage_supplier_catalog_import_lines('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, p_lines);
  perform public.preview_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import);
  return v_import;
end;
$$;
grant execute on function pg_temp.previewed_delivery(text, jsonb) to service_role;

-- The prices of the organization's articles as one sorted text, for before-and-after checks.
create view pg_temp.price_rows as
select string_agg(format('%s/%s/%s/%s/%s/%s', item.name, price.kind, price.amount_cents, price.price_quantity,
    price.valid_from, price.source), ' | ' order by item.name, price.kind, price.created_at) as listing,
  count(*) as total
from public.inventory_item_prices price
join public.inventory_items item on item.id = price.item_id
where price.organization_id = '47700000-0000-4000-8000-000000000010';
grant select on pg_temp.price_rows to service_role;

create temp table price_test_state (key text primary key, value uuid) on commit drop;
grant all on table price_test_state to service_role;
-- No preview writes a price, so the prices before the first confirm are these.
create temp table prices_before on commit drop as select * from pg_temp.price_rows;
grant all on table prices_before to service_role;

-- The new table and functions are server-only.
do $$
declare
  v_role text;
  v_privilege text;
  v_function text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(v_role, 'public.inventory_supplier_rebates', v_privilege) then
        raise exception '% holds % on inventory_supplier_rebates', v_role, v_privilege;
      end if;
    end loop;
    foreach v_function in array array[
      'public.preview_supplier_catalog_import_prices(uuid,uuid,uuid,jsonb)',
      'public.confirm_supplier_catalog_import(uuid,uuid,uuid,jsonb,jsonb,text)',
      'public.confirm_supplier_catalog_import(uuid,uuid,uuid,jsonb)'
    ] loop
      if has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception '% can execute %', v_role, v_function;
      end if;
    end loop;
  end loop;
  foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('service_role', 'public.inventory_supplier_rebates', v_privilege) then
      raise exception 'service_role holds % on inventory_supplier_rebates; only the functions write', v_privilege;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.inventory_supplier_rebates'::regclass) then
    raise exception 'inventory_supplier_rebates runs without RLS';
  end if;
  foreach v_function in array array[
    'app_private.supplier_net_cost_cents(integer,integer)',
    'app_private.inventory_price_differs(integer,integer,integer,integer)',
    'app_private.is_supplier_rebate_mapping(jsonb)',
    'app_private.record_imported_inventory_item_price(uuid,uuid,uuid,text,integer,integer,date,text)',
    'app_private.supplier_catalog_import_price_proposals(uuid,uuid,jsonb)',
    'app_private.supplier_catalog_import_rebate_groups(uuid,uuid)'
  ] loop
    if has_function_privilege('service_role', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception '% is executable outside its owner', v_function;
    end if;
  end loop;
end;
$$;

-- A rebate group's percentage gives the net cost per the price quantity,
-- rounded once, half away from zero.
do $$
declare
  v_case record;
begin
  for v_case in select * from (values
    (61000, 3000, 42700),
    (1001, 5000, 501),
    (1, 5000, 1),
    (3, 5000, 2),
    (999, 3333, 666),
    (1005, 1000, 905),
    (100, 0, 100),
    (100, 10000, 0)
  ) as cases (list_cents, basis_points, net_cents) loop
    if app_private.supplier_net_cost_cents(v_case.list_cents, v_case.basis_points) is distinct from v_case.net_cents then
      raise exception 'the net cost of % less % hundredths of a percent is %, not %', v_case.list_cents,
        v_case.basis_points, app_private.supplier_net_cost_cents(v_case.list_cents, v_case.basis_points),
        v_case.net_cents;
    end if;
  end loop;
end;
$$;

set local role service_role;

insert into price_test_state values ('first', pg_temp.previewed_delivery(repeat('b', 64), jsonb_build_array(
  pg_temp.article(0, 'NR-1501', 'Meter', 'list', 61000, 100, 'CU1'),
  pg_temp.article(1, 'NR-1502', 'Stück', 'list', 389, 1, 'AR1'),
  pg_temp.article(2, 'NR-1503', 'Stück', 'net', 1250, 1, null),
  pg_temp.article(3, 'NR-1504', 'Meter', 'list', 900, 1, 'CU1'),
  pg_temp.article(4, 'NR-1505', 'Stück', 'list', 700, 1, 'AR1'),
  pg_temp.article(5, 'NR-1506', 'Stück', 'list', 200, 1, 'CU1')
)));

-- The preview names each change with its old and new price and writes nothing.
do $$
declare
  v_import uuid := (select value from price_test_state where key = 'first');
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_preview jsonb;
  v_changes text;
begin
  perform pg_temp.expect_refusal('an employee previews prices',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000003', %L, null)$f$, v_import), 'not_authorized');
  perform pg_temp.expect_refusal('a manager of another organization previews prices',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000011',
      '47700000-0000-4000-8000-000000000004', %L, null)$f$, v_import), 'import_not_found');
  perform pg_temp.expect_refusal('the admin previews Büro''s batch',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000001', %L, null)$f$, v_import), 'import_not_found');
  perform pg_temp.expect_refusal('a rebate over 100 %',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"CU1":10001}')$f$, v_import), 'invalid_input');
  perform pg_temp.expect_refusal('a rebate with a fraction of a hundredth',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"CU1":12.5}')$f$, v_import), 'invalid_input');
  perform pg_temp.expect_refusal('a rebate as text',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"CU1":"30"}')$f$, v_import), 'invalid_input');
  perform pg_temp.expect_refusal('a rebate of a blank group',
    format($f$select public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{" ":1}')$f$, v_import), 'invalid_input');

  -- At first: no saved rebate, so the delivery's 30 % for CU1 and none for AR1.
  v_preview := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, null);
  if v_preview->'rebate_groups' is distinct from '[
    {"rebate_group":"AR1","text":"Armaturen","office_basis_points":null,"delivery_basis_points":null},
    {"rebate_group":"CU1","text":"Kupfer","office_basis_points":null,"delivery_basis_points":3000}
  ]'::jsonb or v_preview->'rebates' is distinct from '{"AR1":null,"CU1":3000}'::jsonb then
    raise exception 'the first price preview answered the rebates %', v_preview - 'changes';
  end if;
  -- The fitting's preferred supplier is Westrohr, so Nordrohr's price changes
  -- nothing; the bend's sale price is already 700 cents per one; the sleeve
  -- is listed with its unit text for the office's choice.
  select string_agg(format('%s/%s/%s/%s/%s/%s/%s/%s', change.item->>'item_name', change.item->>'kind',
      change.item->>'old_amount_cents', change.item->>'old_price_quantity', change.item->>'new_amount_cents',
      change.item->>'new_price_quantity', coalesce(change.item->>'unit_text', '-'), change.item->>'valid_from'),
      ' | ' order by change.ordinality)
  into v_changes
  from jsonb_array_elements(v_preview->'changes') with ordinality as change (item, ordinality);
  -- format() writes a missing old price as an empty text.
  if v_changes is distinct from format(
    'Kugelhahn 1/2"/purchase///1250/1/Stück/%1$s | '
    || 'Kupferrohr 15 mm/purchase/400/1/42700/100/Meter/%1$s | '
    || 'Kupferrohr 15 mm/sale/500/1/61000/100/Meter/%1$s | '
    || 'Muffe 15 mm/purchase///630/1/Meter/%1$s | '
    || 'Muffe 15 mm/sale///900/1/Meter/%1$s', v_today)
  then
    raise exception 'the first price preview listed %', v_changes;
  end if;

  -- The office's own rebates: 25 % for CU1, 10 % for AR1.
  v_preview := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"CU1":2500,"AR1":1000}');
  if not v_preview->'changes' @> '[{"item_name":"Kupferrohr 15 mm","kind":"purchase","new_amount_cents":45750,"rebate_basis_points":2500},
      {"item_name":"Bogen 15 mm","kind":"purchase","new_amount_cents":630,"rebate_basis_points":1000}]'::jsonb
    or v_preview->'rebates' is distinct from '{"CU1":2500,"AR1":1000}'::jsonb then
    raise exception 'the price preview with the office''s rebates answered %', v_preview;
  end if;

  if (select listing from pg_temp.price_rows) is distinct from (select listing from prices_before)
    or exists (select 1 from public.inventory_supplier_rebates where organization_id = '47700000-0000-4000-8000-000000000010')
  then
    raise exception 'a price preview wrote a price or a rebate';
  end if;
end;
$$;

-- The confirm saves the rebates and changes prices only through new dated
-- rows: the pipe's sale and net purchase price, the valve's net price. The
-- fitting (another preferred supplier) and the sleeve (another unit) keep theirs.
do $$
declare
  v_import uuid := (select value from price_test_state where key = 'first');
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_result jsonb;
  v_repeat jsonb;
  v_prices record;
  v_shown text;
begin
  perform pg_temp.expect_refusal('an employee confirms',
    format($f$select public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000003', %L, '{}', '{}', null)$f$, v_import), 'not_authorized');
  perform pg_temp.expect_refusal('a confirm with a rebate over 100 %',
    format($f$select public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{}', '{"CU1":-1}', null)$f$, v_import), 'invalid_input');

  -- The office sees AR1 priced at 10 %; a confirm without it would write
  -- prices the office did not see.
  v_shown := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"CU1":2500,"AR1":1000}')->>'fingerprint';
  perform pg_temp.expect_refusal('a confirm with other rebates than the price preview shown',
    format($f$select public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"Meter":"meter","Stück":"piece"}',
      '{"CU1":2500,"AR1":null}', %L)$f$, v_import, v_shown), 'prices_changed');
  v_shown := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"CU1":2500,"AR1":null}')->>'fingerprint';
  -- Another session gives the fitting Nordrohr as its preferred supplier after
  -- the preview, so the confirm would change a price the preview never listed.
  perform public.save_inventory_item_supplier('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', '47700000-0000-4000-8000-000000000022', 'piece',
    (select id from public.inventory_item_suppliers where item_id = '47700000-0000-4000-8000-000000000022'
      and supplier_id = '47700000-0000-4000-8000-000000000030'),
    '47700000-0000-4000-8000-000000000030', null, 'NR-1502', null, 1, 1, true);
  perform pg_temp.expect_refusal('a confirm after a reference changed since the price preview',
    format($f$select public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"Meter":"meter","Stück":"piece"}',
      '{"CU1":2500,"AR1":null}', %L)$f$, v_import, v_shown), 'prices_changed');
  -- A later price preview runs, but its answer never reaches the dialog,
  -- which still shows the earlier prices: the confirm still refuses.
  perform public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"CU1":2500,"AR1":null}');
  perform pg_temp.expect_refusal('a confirm of a preview older than a lost one',
    format($f$select public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
      '47700000-0000-4000-8000-000000000002', %L, '{"Meter":"meter","Stück":"piece"}',
      '{"CU1":2500,"AR1":null}', %L)$f$, v_import, v_shown), 'prices_changed');
  if (select total from pg_temp.price_rows) is distinct from (select total from prices_before) then
    raise exception 'a refused confirm wrote prices';
  end if;
  -- Westrohr preferred again, as the price preview showed it.
  perform public.save_inventory_item_supplier('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', '47700000-0000-4000-8000-000000000022', 'piece',
    (select id from public.inventory_item_suppliers where item_id = '47700000-0000-4000-8000-000000000022'
      and supplier_id = '47700000-0000-4000-8000-000000000031'),
    '47700000-0000-4000-8000-000000000031', null, 'WR-1502', null, 1, 1, true);

  v_result := public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter","Stück":"piece"}',
    '{"CU1":2500,"AR1":null}', v_shown);
  if (v_result->>'own_prices_changed')::integer is distinct from 3 then
    raise exception 'the confirm answered %', v_result;
  end if;
  if (select total from pg_temp.price_rows) is distinct from (select total from prices_before) + 3 then
    raise exception 'the confirm wrote other prices: %', (select listing from pg_temp.price_rows);
  end if;
  if (select count(*) from public.inventory_item_prices
      where organization_id = '47700000-0000-4000-8000-000000000010' and source = 'datanorm'
        and valid_from = v_today and created_by = '47700000-0000-4000-8000-000000000002')
    is distinct from 3 then
    raise exception 'the confirm''s prices are not three DATANORM rows from today by Büro';
  end if;
  select * into v_prices from public.read_inventory_item_prices_on_day('47700000-0000-4000-8000-000000000010',
    array['47700000-0000-4000-8000-000000000021'::uuid], v_today);
  if (v_prices.purchase_amount_cents, v_prices.purchase_price_quantity, v_prices.sale_amount_cents,
      v_prices.sale_price_quantity) is distinct from (45750, 100, 61000, 100) then
    raise exception 'the pipe''s price of today is %', v_prices;
  end if;
  if exists (select 1 from public.inventory_item_prices
      where item_id in ('47700000-0000-4000-8000-000000000022', '47700000-0000-4000-8000-000000000024',
        '47700000-0000-4000-8000-000000000025') and source = 'datanorm') then
    raise exception 'another preferred supplier, another unit or an equal price changed a price';
  end if;
  -- The previous day keeps its price.
  select * into v_prices from public.read_inventory_item_prices_on_day('47700000-0000-4000-8000-000000000010',
    array['47700000-0000-4000-8000-000000000021'::uuid], v_today - 1);
  if (v_prices.purchase_amount_cents, v_prices.sale_amount_cents) is distinct from (400, 500) then
    raise exception 'the confirm rewrote a past day: %', v_prices;
  end if;
  if (select array_agg(row(rebate_group, rebate_basis_points, updated_by)::text order by rebate_group)
      from public.inventory_supplier_rebates where organization_id = '47700000-0000-4000-8000-000000000010')
    is distinct from array[row('CU1', 2500, '47700000-0000-4000-8000-000000000002'::uuid)::text]
    or (select rebates from public.inventory_supplier_catalog_imports where id = v_import)
      is distinct from '{"CU1":2500,"AR1":null}'::jsonb then
    raise exception 'the confirm saved the rebates wrong';
  end if;

  -- A repeat confirm changes nothing and answers the first result.
  v_repeat := public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter","Stück":"piece"}', '{"CU1":100}', null);
  if v_repeat is distinct from (v_result - 'already_confirmed') || '{"already_confirmed":true}'::jsonb
    or (select total from pg_temp.price_rows) is distinct from (select total from prices_before) + 3
    or (select rebate_basis_points from public.inventory_supplier_rebates
      where organization_id = '47700000-0000-4000-8000-000000000010' and rebate_group = 'CU1') is distinct from 2500
  then
    raise exception 'a repeat confirm changed something: %', v_repeat;
  end if;
end;
$$;

-- The same prices delivered again change nothing; a price line of a catalog
-- row changes the valve's price in the catalog's unit; the saved rebate is
-- the next preview's start.
do $$
declare
  v_import uuid;
  v_preview jsonb;
  v_result jsonb;
  v_before bigint := (select total from pg_temp.price_rows);
begin
  v_import := pg_temp.previewed_delivery(repeat('c', 64), jsonb_build_array(
    pg_temp.article(0, 'NR-1501', 'Meter', 'list', 61000, 100, 'CU1'),
    pg_temp.article(1, 'NR-1503', 'Stück', 'net', 1250, 1, null)));
  v_preview := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, null);
  if v_preview->'changes' is distinct from '[]'::jsonb or v_preview->'rebates' is distinct from '{"CU1":2500}'::jsonb then
    raise exception 'the same prices again previewed %', v_preview;
  end if;
  v_result := public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter","Stück":"piece"}', v_preview->'rebates',
    v_preview->>'fingerprint');
  if (v_result->>'own_prices_changed')::integer is distinct from 0
    or (select total from pg_temp.price_rows) is distinct from v_before then
    raise exception 'the same prices again wrote %', v_result;
  end if;

  v_import := pg_temp.previewed_delivery(repeat('d', 64), jsonb_build_array(
    jsonb_build_object('ordinal', 0, 'kind', 'price', 'file_name', 'preise', 'line_number', 1,
      'article_number', 'NR-1503', 'price_kind', 'net', 'price_cents', 1300)));
  v_preview := public.preview_supplier_catalog_import_prices('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, null);
  if not v_preview->'changes' @> '[{"item_name":"Kugelhahn 1/2\"","kind":"purchase","catalog_unit":"piece",
      "unit_text":null,"old_amount_cents":1250,"new_amount_cents":1300}]'::jsonb
    or jsonb_array_length(v_preview->'changes') is distinct from 1 then
    raise exception 'a price line previewed %', v_preview;
  end if;
  v_result := public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{}', '{}', v_preview->>'fingerprint');
  if (v_result->>'own_prices_changed')::integer is distinct from 1 then
    raise exception 'a price line confirmed %', v_result;
  end if;
end;
$$;

-- The previous release's confirm writes the catalog only.
do $$
declare
  v_import uuid;
  v_result jsonb;
  v_before bigint := (select total from pg_temp.price_rows);
begin
  v_import := pg_temp.previewed_delivery(repeat('e', 64), jsonb_build_array(
    pg_temp.article(0, 'NR-1501', 'Meter', 'list', 64000, 100, 'CU1')));
  v_result := public.confirm_supplier_catalog_import('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter"}');
  if (v_result->>'own_prices_changed')::integer is distinct from 0
    or (select total from pg_temp.price_rows) is distinct from v_before
    or (select price_cents from public.inventory_supplier_catalog_articles
      where organization_id = '47700000-0000-4000-8000-000000000010' and article_number = 'NR-1501') is distinct from 64000 then
    raise exception 'the four-argument confirm answered % and changed own prices', v_result;
  end if;
end;
$$;

-- Adopting a list-priced catalog row with a saved rebate records its net cost too.
do $$
declare
  v_adopted jsonb;
  v_prices record;
begin
  v_adopted := public.adopt_supplier_catalog_article('47700000-0000-4000-8000-000000000010',
    '47700000-0000-4000-8000-000000000002', (
      select id from public.inventory_supplier_catalog_articles
      where organization_id = '47700000-0000-4000-8000-000000000010' and article_number = 'NR-1506'));
  select * into v_prices from public.read_inventory_item_prices_on_day('47700000-0000-4000-8000-000000000010',
    array[(v_adopted->>'item_id')::uuid], (now() at time zone 'Europe/Berlin')::date);
  if (v_prices.sale_amount_cents, v_prices.purchase_amount_cents, v_prices.purchase_source)
    is distinct from (200, 150, 'datanorm') then
    raise exception 'the adopted row''s prices are %', v_prices;
  end if;
end;
$$;

-- A reviewed CSV row that matches an own article changes its price only
-- through a dated CSV-import row, previewed with the old and the new price.
do $$
declare
  v_org constant uuid := '47700000-0000-4000-8000-000000000010';
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Rohrschelle', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'SB-100', 'purchase_price_cents', 320, 'sale_price_cents', 450,
      'is_billable', true, 'global_minimum_stock', 0)),
    -- The same purchase price again in a second row changes nothing more.
    jsonb_build_object('item', jsonb_build_object('name', 'Rohrschelle', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'SB-100', 'purchase_price_cents', 320,
      'is_billable', true, 'global_minimum_stock', 0)));
  v_before bigint := (select total from pg_temp.price_rows);
  v_preview jsonb;
  v_booking jsonb;
  v_repeat jsonb;
begin
  -- A batch the previous release previews and books changes no price.
  v_preview := public.preview_inventory_import(v_org, '47700000-0000-4000-8000-000000000002', 'alt.csv',
    '{}'::jsonb, repeat('e', 64), 'master_data', v_rows);
  v_booking := public.book_inventory_import(v_org, '47700000-0000-4000-8000-000000000002',
    (v_preview->>'batch_id')::uuid);
  if v_booking->'rows'->0->'price_changes' is distinct from '[]'::jsonb
    or (select total from pg_temp.price_rows) is distinct from v_before then
    raise exception 'a batch of the previous release''s preview changed prices: %', v_booking->'rows';
  end if;

  v_preview := public.preview_inventory_import(v_org, '47700000-0000-4000-8000-000000000002', 'preise.csv',
    '{}'::jsonb, repeat('f', 64), 'master_data', v_rows, true);
  if v_preview->'rows'->0->'price_changes' is distinct from format('[
      {"kind":"purchase","old_amount_cents":300,"old_price_quantity":1,"new_amount_cents":320,"new_price_quantity":1,"valid_from":"%1$s"},
      {"kind":"sale","old_amount_cents":null,"old_price_quantity":null,"new_amount_cents":450,"new_price_quantity":1,"valid_from":"%1$s"}
    ]', v_today)::jsonb
    or v_preview->'rows'->1->'price_changes' is distinct from '[]'::jsonb
    or (select total from pg_temp.price_rows) is distinct from v_before then
    raise exception 'the CSV preview answered % and wrote prices', v_preview->'rows';
  end if;
  v_booking := public.book_inventory_import(v_org, '47700000-0000-4000-8000-000000000002',
    (v_preview->>'batch_id')::uuid);
  if v_booking->'rows' is distinct from v_preview->'rows'
    or (select count(*) from public.inventory_item_prices
      where item_id = '47700000-0000-4000-8000-000000000026' and source = 'csv_import' and valid_from = v_today)
      is distinct from 2::bigint
    or (select total from pg_temp.price_rows) is distinct from v_before + 2 then
    raise exception 'the CSV booking answered % and wrote other prices', v_booking->'rows';
  end if;
  v_repeat := public.book_inventory_import(v_org, '47700000-0000-4000-8000-000000000002',
    (v_preview->>'batch_id')::uuid);
  if (v_repeat->>'already_booked')::boolean is not true
    or (select total from pg_temp.price_rows) is distinct from v_before + 2 then
    raise exception 'a repeated CSV booking wrote prices again';
  end if;
end;
$$;

-- A CSV booking holds to the prices its preview showed: the preview shows no
-- change of the clamp's 320 cents, another session records 350, and the
-- booking refuses the row instead of writing 320 over it.
do $$
declare
  v_org constant uuid := '47700000-0000-4000-8000-000000000010';
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_preview jsonb;
  v_booking jsonb;
  v_prices record;
begin
  v_preview := public.preview_inventory_import(v_org, '47700000-0000-4000-8000-000000000002', 'nochmal.csv',
    '{}'::jsonb, repeat('d', 64), 'master_data', jsonb_build_array(
      jsonb_build_object('item', jsonb_build_object('name', 'Rohrschelle', 'item_type', 'material',
        'unit', 'piece', 'internal_sku', 'SB-100', 'purchase_price_cents', 320,
        'is_billable', true, 'global_minimum_stock', 0))), true);
  if v_preview->'rows'->0->'price_changes' is distinct from '[]'::jsonb then
    raise exception 'the unchanged price previewed %', v_preview->'rows';
  end if;
  perform public.add_inventory_item_price(v_org, '47700000-0000-4000-8000-000000000001',
    '47700000-0000-4000-8000-000000000026', 'piece', 'purchase', 350, 1, v_today);
  v_booking := public.book_inventory_import(v_org, '47700000-0000-4000-8000-000000000002',
    (v_preview->>'batch_id')::uuid);
  select * into v_prices from public.read_inventory_item_prices_on_day(v_org,
    array['47700000-0000-4000-8000-000000000026'::uuid], v_today);
  if v_booking->'rows'->0 @> '{"outcome":"rejected","reason":"changed_since_preview"}' is not true
    or v_prices.purchase_amount_cents is distinct from 350 then
    raise exception 'a price changed since the preview was overwritten: % (purchase %)', v_booking->'rows',
      v_prices.purchase_amount_cents;
  end if;
end;
$$;

rollback;
