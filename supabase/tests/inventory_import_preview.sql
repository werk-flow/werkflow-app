-- The CSV import shows its effect before it books, and a confirm books once
-- (migration 20261202120000_preview_the_inventory_import_and_book_it_once.sql):
-- the preview and the booking run the same row rule and agree row by row, the
-- preview leaves nothing but its draft batch, a confirm sent twice books once,
-- a Stammdaten-only batch books no stock, a row with an unknown or a differing
-- unit leaves nothing behind, the booking holds to the article and the Lager
-- the preview resolved, the batch keeps who previewed and who booked it, and
-- only a manager of the batch's organization previews or books it.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('99200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'import-preview-admin@example.test', '', now(), '{}', '{}', now(), now()),
('99200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'import-preview-employee@example.test', '', now(), '{}', '{}', now(), now()),
('99200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'import-preview-foreign@example.test', '', now(), '{}', '{}', now(), now()),
('99200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'import-preview-buero@example.test', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('99200000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg', '99200000-0000-4000-8000-000000000001', 'IMPPREVA'),
('99200000-0000-4000-8000-000000000011', 'Fremdbetrieb', '99200000-0000-4000-8000-000000000003', 'IMPPREVB');
insert into public.organization_members (organization_id, user_id, role) values
('99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000002', 'employee'),
('99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000004', 'buero');

insert into public.inventory_locations (id, organization_id, name, location_type, created_by, created_at) values
('99200000-0000-4000-8000-000000000020', '99200000-0000-4000-8000-000000000010', 'Hauptlager', 'storage',
 '99200000-0000-4000-8000-000000000001', now() - interval '1 day');
-- Step 4g's Werkstatt: a shelf inside Hauptlager, the only Lager of that name.
insert into public.inventory_locations (id, organization_id, name, location_type, parent_location_id, created_by, created_at) values
('99200000-0000-4000-8000-000000000022', '99200000-0000-4000-8000-000000000010', 'Werkstatt', 'shelf',
 '99200000-0000-4000-8000-000000000020', '99200000-0000-4000-8000-000000000001', now() - interval '1 day');
insert into public.inventory_items (id, organization_id, name, item_type, unit, internal_sku, created_by) values
('99200000-0000-4000-8000-000000000030', '99200000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm', 'material',
 'meter', 'NR-ROHR-15', '99200000-0000-4000-8000-000000000001'),
-- Step 4e's two articles, each matched by one path only and never updated here.
('99200000-0000-4000-8000-000000000032', '99200000-0000-4000-8000-000000000010', 'Kugelhahn 3/4"', 'material',
 'piece', 'NR-KH-34', '99200000-0000-4000-8000-000000000001'),
('99200000-0000-4000-8000-000000000033', '99200000-0000-4000-8000-000000000010', 'Thermostatkopf', 'material',
 'piece', null, '99200000-0000-4000-8000-000000000001');
insert into public.inventory_item_barcodes (organization_id, item_id, barcode_value, is_primary) values
('99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000030', '4000000000015', true),
('99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000033', '4000000000077', true);
-- A draft the previous release created: it carries no staged rows.
insert into public.inventory_import_batches (id, organization_id, file_name, created_by) values
('99200000-0000-4000-8000-000000000040', '99200000-0000-4000-8000-000000000010', 'alt.csv',
 '99200000-0000-4000-8000-000000000001');

-- The rows a CSV file of Großhandel Nordrohr becomes after the action read it.
create function pg_temp.file_rows()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    -- 0: a new item, first count in Hauptlager.
    jsonb_build_object('item', jsonb_build_object('name', 'Pressfitting 15 mm', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-FIT-15', 'is_billable', true, 'global_minimum_stock', 0),
      'category_name', 'Fittings', 'location_name', 'Hauptlager', 'quantity', 10),
    -- 1: matches the pipe by Artikelnummer and adds 5 m.
    jsonb_build_object('item', jsonb_build_object('name', 'Kupferrohr', 'item_type', 'material',
      'unit', 'meter', 'internal_sku', 'NR-ROHR-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 5),
    -- 2: matches the pipe by barcode, into a Lager the import creates.
    jsonb_build_object('item', jsonb_build_object('name', 'Rohr 15', 'item_type', 'material',
      'unit', 'meter', 'is_billable', true, 'global_minimum_stock', 0),
      'barcode', '4000000000015', 'location_name', 'Regal Nord', 'quantity', 2),
    -- 3: matches the pipe but counts in Stück: refused, and its category is never created.
    jsonb_build_object('item', jsonb_build_object('name', 'Kupferrohr', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-ROHR-15', 'is_billable', true, 'global_minimum_stock', 0),
      'category_name', 'Nur abgelehnt', 'location_name', 'Hauptlager', 'quantity', 4),
    -- 4: refused by the action for its unknown unit.
    jsonb_build_object('rejection', 'unknown_unit'),
    -- 5: matches row 0's new item inside the same file.
    jsonb_build_object('item', jsonb_build_object('name', 'Pressfitting', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-FIT-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 3)
  );
$$;
grant execute on function pg_temp.file_rows() to service_role;

-- Runs the statement and expects the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_code text)
returns void
language plpgsql
as $$
begin
  execute p_statement;
  raise exception '% was not refused', p_label;
exception when others then
  if sqlerrm <> p_code then
    raise exception '% refused with "%" instead of %', p_label, sqlerrm, p_code;
  end if;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Everything a row could write in the organization, to prove what stayed.
create view pg_temp.org_counts as
select
  (select count(*) from public.inventory_items where organization_id = '99200000-0000-4000-8000-000000000010') items,
  (select count(*) from public.inventory_item_barcodes where organization_id = '99200000-0000-4000-8000-000000000010') barcodes,
  (select count(*) from public.inventory_movements where organization_id = '99200000-0000-4000-8000-000000000010') movements,
  (select count(*) from public.inventory_stock_levels where organization_id = '99200000-0000-4000-8000-000000000010') stock_levels,
  (select count(*) from public.inventory_locations where organization_id = '99200000-0000-4000-8000-000000000010') locations,
  (select count(*) from public.inventory_categories where organization_id = '99200000-0000-4000-8000-000000000010') categories;
grant select on pg_temp.org_counts to service_role;

create temporary table preview_answers (label text primary key, answer jsonb);
grant all on preview_answers to service_role;

set local role service_role;

-- 1. The preview answers every row's effect and writes nothing but its draft batch.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_before jsonb;
  v_preview jsonb;
  v_rows jsonb;
begin
  select to_jsonb(c) into v_before from pg_temp.org_counts c;
  v_preview := public.preview_inventory_import(
    v_org, v_admin, 'nordrohr.csv', '{"name":"Bezeichnung"}'::jsonb, repeat('a', 64), 'stock', pg_temp.file_rows()
  );
  insert into preview_answers values ('stock', v_preview);
  v_rows := v_preview->'rows';

  if (select to_jsonb(c) from pg_temp.org_counts c) is distinct from v_before then
    raise exception 'a preview must leave items, barcodes, movements, stock, Lager and categories unchanged';
  end if;
  if not exists (
    select 1 from public.inventory_import_batches batch
    where batch.id = (v_preview->>'batch_id')::uuid and batch.organization_id = v_org and batch.status = 'draft'
      and batch.mode = 'stock' and batch.content_hash = repeat('a', 64) and batch.row_count = 6
      and batch.created_by = v_admin
      -- The staged rows are the file's rows, each with what the preview resolved.
      and (select jsonb_agg(staged.value - 'previewed_item' - 'previewed_location' - 'previewed_rejection'
          order by staged.ordinality)
        from jsonb_array_elements(batch.staged_rows) with ordinality staged) = pg_temp.file_rows()
  ) then
    raise exception 'a preview must stage its rows on a draft batch with the file''s hash and mode';
  end if;

  if jsonb_array_length(v_rows) <> 6
    or v_rows->0 @> '{"index":0,"outcome":"booked","matched_by":null,"unit":"piece","location_name":"Hauptlager","location_created":false,"quantity":10,"quantity_before":0,"quantity_after":10}' is not true
    or v_rows->1 @> '{"index":1,"outcome":"booked","matched_by":"internal_sku","item_name":"Kupferrohr 15 mm","unit":"meter","quantity_before":0,"quantity_after":5}' is not true
    or v_rows->2 @> '{"index":2,"outcome":"booked","matched_by":"barcode","item_name":"Kupferrohr 15 mm","location_name":"Regal Nord","location_created":true,"quantity_after":2}' is not true
    or v_rows->3 @> '{"index":3,"outcome":"rejected","reason":"unit_mismatch","unit":"piece","item_unit":"meter"}' is not true
    or v_rows->4 @> '{"index":4,"outcome":"rejected","reason":"unknown_unit"}' is not true
    or v_rows->5 @> '{"index":5,"outcome":"booked","matched_by":"internal_sku","item_name":"Pressfitting 15 mm","quantity_before":10,"quantity_after":13}' is not true
  then
    raise exception 'a preview must answer create or match, unit, Lager and resulting stock per row, and refuse a differing or unknown unit: %', v_rows;
  end if;
end;
$$;

-- 2. The booking runs the same rule, agrees with the preview row by row, and a
--    confirm sent twice books once.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_preview constant jsonb := (select answer from preview_answers where label = 'stock');
  v_batch constant uuid := (v_preview->>'batch_id')::uuid;
  v_booking jsonb;
  v_repeat jsonb;
  v_movements integer;
begin
  v_booking := public.book_inventory_import(v_org, v_admin, v_batch);
  if v_booking->>'already_booked' <> 'false' or v_booking->'rows' is distinct from v_preview->'rows' then
    raise exception 'the booking must agree with the preview on every row: % against %', v_booking->'rows', v_preview->'rows';
  end if;
  if not exists (
    select 1 from public.inventory_import_batches batch
    where batch.id = v_batch and batch.status = 'failed' and batch.imported_count = 4 and batch.failed_count = 2
      and batch.completed_at is not null and batch.result_payload = v_booking->'rows'
  ) then
    raise exception 'a booked batch must close with its counts and keep each row''s outcome';
  end if;
  if (select count(*) from public.inventory_movements where import_batch_id = v_batch) <> 4
    or (select quantity_on_hand from public.inventory_stock_levels
      where item_id = '99200000-0000-4000-8000-000000000030' and location_id = '99200000-0000-4000-8000-000000000020') is distinct from 5
  then
    raise exception 'the booking must book exactly the four accepted rows';
  end if;

  select count(*) into v_movements from public.inventory_movements where organization_id = v_org;
  v_repeat := public.book_inventory_import(v_org, v_admin, v_batch);
  if v_repeat->>'already_booked' <> 'true' or v_repeat->'rows' is distinct from v_booking->'rows'
    or (select count(*) from public.inventory_movements where organization_id = v_org) <> v_movements
  then
    raise exception 'a confirm sent twice must book once and answer the first booking''s rows';
  end if;
end;
$$;

-- 3. A refused row leaves nothing behind: no movement of the differing unit's
--    quantity, no category it named, no item for the unknown unit.
do $$
begin
  if exists (select 1 from public.inventory_movements
      where item_id = '99200000-0000-4000-8000-000000000030' and quantity_delta = 4)
    or exists (select 1 from public.inventory_categories
      where organization_id = '99200000-0000-4000-8000-000000000010' and name = 'Nur abgelehnt')
    or (select unit from public.inventory_items where id = '99200000-0000-4000-8000-000000000030') <> 'meter'
  then
    raise exception 'a row with a differing unit must leave no movement, category or unit change behind';
  end if;
end;
$$;

-- 4. A Stammdaten-only batch creates its items but books no stock and creates no Lager.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Kugelhahn 1/2"', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-KH-12', 'is_billable', true, 'global_minimum_stock', 0,
      'purchase_price_cents', 1250), 'location_name', 'Stammdatenregal', 'quantity', 7),
    jsonb_build_object('item', jsonb_build_object('name', 'Kupferrohr', 'item_type', 'material',
      'unit', 'meter', 'internal_sku', 'NR-ROHR-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 9)
  );
  v_preview jsonb;
  v_booking jsonb;
  v_batch uuid;
begin
  v_preview := public.preview_inventory_import(v_org, v_admin, 'stammdaten.csv', '{}'::jsonb, null, 'master_data', v_rows);
  v_batch := (v_preview->>'batch_id')::uuid;
  v_booking := public.book_inventory_import(v_org, v_admin, v_batch);
  if v_booking->'rows' is distinct from v_preview->'rows'
    or v_booking->'rows'->0 @> '{"outcome":"imported","matched_by":null,"location_name":null,"quantity":7,"quantity_after":null}' is not true
    or v_booking->'rows'->1 @> '{"outcome":"imported","matched_by":"internal_sku","quantity_after":null}' is not true
  then
    raise exception 'a Stammdaten-only batch must answer every row as imported without stock: %', v_booking->'rows';
  end if;
  if exists (select 1 from public.inventory_movements where import_batch_id = v_batch)
    or exists (select 1 from public.inventory_locations where organization_id = v_org and name = 'Stammdatenregal')
    or not exists (select 1 from public.inventory_items
      where organization_id = v_org and internal_sku = 'NR-KH-12' and purchase_price_cents = 1250)
  then
    raise exception 'a Stammdaten-only batch must create its items and prices but write no movement and no Lager';
  end if;
end;
$$;

-- 4b. A matched row changes no article: no barcode attached, no category or
--     supplier created; a barcode of another article refuses it; and a row
--     that books nothing creates no Lager.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Kupferrohr', 'item_type', 'material',
      'unit', 'meter', 'internal_sku', 'NR-ROHR-15', 'is_billable', true, 'global_minimum_stock', 0),
      'barcode', '4000000000099', 'category_name', 'Nur Treffer', 'supplier_name', 'Großhandel Treffer',
      'location_name', 'Hauptlager', 'quantity', 1),
    jsonb_build_object('item', jsonb_build_object('name', 'Pressfitting', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-FIT-15', 'is_billable', true, 'global_minimum_stock', 0),
      'barcode', '4000000000015', 'location_name', 'Hauptlager', 'quantity', 1),
    jsonb_build_object('item', jsonb_build_object('name', 'Muffe 15 mm', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-MU-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Leeres Regal', 'quantity', 0)
  );
  v_booking jsonb;
begin
  v_booking := public.book_inventory_import(v_org, v_admin, (public.preview_inventory_import(
    v_org, v_admin, 'treffer.csv', '{}'::jsonb, null, 'stock', v_rows)->>'batch_id')::uuid);
  if v_booking->'rows'->0 @> '{"outcome":"booked","matched_by":"internal_sku"}' is not true
    or v_booking->'rows'->1 @> '{"outcome":"rejected","reason":"barcode_taken"}' is not true
    or v_booking->'rows'->2 @> '{"outcome":"imported","matched_by":null,"location_name":null}' is not true
  then
    raise exception 'a matched row must book its quantity, a foreign barcode refuse it, a zero row book nothing: %', v_booking->'rows';
  end if;
  if exists (select 1 from public.inventory_item_barcodes where organization_id = v_org and barcode_value = '4000000000099')
    or exists (select 1 from public.inventory_categories where organization_id = v_org and name = 'Nur Treffer')
    or exists (select 1 from public.inventory_suppliers where organization_id = v_org and name = 'Großhandel Treffer')
    or not exists (select 1 from public.inventory_item_barcodes
      where item_id = '99200000-0000-4000-8000-000000000030' and barcode_value = '4000000000015' and is_primary)
  then
    raise exception 'a matched row must leave the article''s barcodes unchanged and create no category or supplier';
  end if;
  if exists (select 1 from public.inventory_locations where organization_id = v_org and name = 'Leeres Regal') then
    raise exception 'a row that books no quantity must create no Lager';
  end if;
end;
$$;

-- 4c. A row that fails for a reason the rule does not name carries its
--     SQLSTATE and nothing else, and the other rows still book. The booking
--     keeps the preview's rejection without the code, which the preview's
--     action logged.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    -- An item type outside the table's check constraint: a check violation (23514).
    jsonb_build_object('item', jsonb_build_object('name', 'Unbekannter Typ', 'item_type', 'gadget',
      'unit', 'piece', 'internal_sku', 'NR-GADGET', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 1),
    jsonb_build_object('item', jsonb_build_object('name', 'Rotguss-Bogen 15 mm', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-BOGEN-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 6)
  );
  v_preview jsonb;
  v_booking jsonb;
begin
  v_preview := public.preview_inventory_import(v_org, v_admin, 'unerwartet.csv', '{}'::jsonb, null, 'stock', v_rows);
  v_booking := public.book_inventory_import(v_org, v_admin, (v_preview->>'batch_id')::uuid);
  if v_booking->'rows' is distinct from (select jsonb_agg(result.value - 'code' order by result.ordinality)
      from jsonb_array_elements(v_preview->'rows') with ordinality result)
  then
    raise exception 'the booking must keep the preview''s rejection of an unexpected row failure: % against %',
      v_preview->'rows', v_booking->'rows';
  end if;
  if v_preview->'rows'->0 @> '{"outcome":"rejected","reason":"failed","code":"23514"}' is not true
    or (v_preview->'rows'->0) ?| array['message', 'detail']
    or v_booking->'rows'->1 @> '{"outcome":"booked","quantity_after":6}' is not true
    or exists (select 1 from public.inventory_items where organization_id = v_org and internal_sku = 'NR-GADGET')
  then
    raise exception 'an unexpected row failure must carry its SQLSTATE, leave nothing behind and let the other rows book: %',
      v_booking->'rows';
  end if;
  -- A named refusal carries no code: its reason says it all.
  if exists (
    select 1 from jsonb_array_elements(v_booking->'rows') result
    where result.value->>'reason' <> 'failed' and result.value ? 'code'
  ) then
    raise exception 'a named refusal must carry no SQLSTATE';
  end if;
  -- Managers read the stored result through the Data API: it keeps no code,
  -- and a repeated confirm answers the rows without it.
  if exists (
    select 1 from public.inventory_import_batches batch, jsonb_array_elements(batch.result_payload) result
    where batch.organization_id = v_org and result.value ? 'code'
  )
    or (public.book_inventory_import(v_org, v_admin, (v_preview->>'batch_id')::uuid)->'rows')
      is distinct from (select jsonb_agg(result.value - 'code' order by result.ordinality)
        from jsonb_array_elements(v_booking->'rows') with ordinality result)
  then
    raise exception 'a stored booking result must keep no SQLSTATE';
  end if;
end;
$$;

-- 4d. The booking holds to what the preview resolved: a row whose
--     Artikelnummer moved to no article after the preview is refused instead
--     of creating one, and a row the preview rejected stays rejected even when
--     the article changed so that it would pass now.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Rotguss-Bogen', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-BOGEN-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 2),
    jsonb_build_object('item', jsonb_build_object('name', 'Pressfitting', 'item_type', 'material',
      'unit', 'meter', 'internal_sku', 'NR-FIT-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 3),
    jsonb_build_object('item', jsonb_build_object('name', 'Kupferrohr', 'item_type', 'material',
      'unit', 'meter', 'internal_sku', 'NR-ROHR-15', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 1)
  );
  v_preview jsonb;
  v_booking jsonb;
  v_movements integer;
begin
  v_preview := public.preview_inventory_import(v_org, v_admin, 'spaeter.csv', '{}'::jsonb, null, 'stock', v_rows);
  if v_preview->'rows'->0 @> '{"outcome":"booked","matched_by":"internal_sku"}' is not true
    or v_preview->'rows'->1 @> '{"outcome":"rejected","reason":"unit_mismatch"}' is not true
  then
    raise exception 'the preview must match the Rotguss-Bogen and refuse the Pressfitting in Meter: %', v_preview->'rows';
  end if;

  -- After the preview, someone moves the Bogen's Artikelnummer and counts the fitting in Meter.
  update public.inventory_items set internal_sku = 'NR-BOGEN-15-ALT'
  where organization_id = v_org and internal_sku = 'NR-BOGEN-15';
  update public.inventory_items set unit = 'meter'
  where organization_id = v_org and internal_sku = 'NR-FIT-15';
  select count(*) into v_movements from public.inventory_movements where organization_id = v_org;

  v_booking := public.book_inventory_import(v_org, v_admin, (v_preview->>'batch_id')::uuid);
  if v_booking->'rows'->0 @> '{"outcome":"rejected","reason":"changed_since_preview"}' is not true
    or v_booking->'rows'->1 is distinct from v_preview->'rows'->1
    or v_booking->'rows'->2 @> '{"outcome":"booked","matched_by":"internal_sku"}' is not true
  then
    raise exception 'the booking must refuse a row whose match changed and keep a previewed rejection: %', v_booking->'rows';
  end if;
  if exists (select 1 from public.inventory_items where organization_id = v_org and internal_sku = 'NR-BOGEN-15')
    or (select count(*) from public.inventory_movements where organization_id = v_org) <> v_movements + 1
  then
    raise exception 'a row whose match changed or that the preview rejected must leave nothing behind';
  end if;
end;
$$;

-- 4g. The booking holds to the Lager the preview resolved: a top-level Lager
--     of the same name created after the preview, which the name lookup
--     prefers, refuses the row instead of receiving stock the preview never
--     showed. Two rows that name one Lager the import creates still book into
--     that one new Lager.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_shelf constant uuid := '99200000-0000-4000-8000-000000000022';
  v_new_top constant uuid := '99200000-0000-4000-8000-000000000021';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Heizkörperventil 1/2"', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-HKV-12', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Werkstatt', 'quantity', 2),
    jsonb_build_object('item', jsonb_build_object('name', 'Spülkasten', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-SK-1', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Wagen 7', 'quantity', 1),
    jsonb_build_object('item', jsonb_build_object('name', 'Siphon 40 mm', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-SI-40', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Wagen 7', 'quantity', 4)
  );
  v_preview jsonb;
  v_booking jsonb;
  v_batch uuid;
begin
  v_preview := public.preview_inventory_import(v_org, v_admin, 'werkstatt.csv', '{}'::jsonb, null, 'stock', v_rows);
  v_batch := (v_preview->>'batch_id')::uuid;
  if v_preview->'rows'->0 @> '{"outcome":"booked","location_name":"Werkstatt","location_created":false}' is not true
    or v_preview->'rows'->1 @> '{"outcome":"booked","location_name":"Wagen 7","location_created":true}' is not true
    or v_preview->'rows'->2 @> '{"outcome":"booked","location_name":"Wagen 7","location_created":true}' is not true
  then
    raise exception 'the preview must book into the Werkstatt shelf and one new Wagen 7: %', v_preview->'rows';
  end if;

  -- After the preview, someone creates a top-level Lager named Werkstatt.
  insert into public.inventory_locations (id, organization_id, name, location_type, created_by)
  values (v_new_top, v_org, 'Werkstatt', 'room', v_admin);

  v_booking := public.book_inventory_import(v_org, v_admin, v_batch);
  if v_booking->'rows'->0 @> '{"outcome":"rejected","reason":"changed_since_preview"}' is not true
    or v_booking->'rows'->1 @> '{"outcome":"booked","location_name":"Wagen 7","location_created":true,"quantity_after":1}' is not true
    or v_booking->'rows'->2 @> '{"outcome":"booked","location_name":"Wagen 7","location_created":true,"quantity_after":4}' is not true
  then
    raise exception 'the booking must refuse a row whose Lager changed and book both rows into the new Lager: %',
      v_booking->'rows';
  end if;
  if exists (select 1 from public.inventory_movements where location_id in (v_new_top, v_shelf))
    or exists (select 1 from public.inventory_items where organization_id = v_org and internal_sku = 'NR-HKV-12')
  then
    raise exception 'a row whose Lager changed since the preview must leave no movement and no article behind';
  end if;
  if (select count(*) from public.inventory_locations where organization_id = v_org and name = 'Wagen 7') <> 1
    or (select count(*) from public.inventory_movements movement
      join public.inventory_locations location on location.id = movement.location_id
      where movement.import_batch_id = v_batch and location.name = 'Wagen 7') <> 2
  then
    raise exception 'two rows that name one new Lager must book into that one Lager';
  end if;
end;
$$;

-- 4h. The batch keeps who previewed it and who booked it, so the repeat
--     warning names the person who booked.
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_buero constant uuid := '99200000-0000-4000-8000-000000000004';
  v_batch uuid;
begin
  v_batch := (public.preview_inventory_import(v_org, v_admin, 'zwei-personen.csv', '{}'::jsonb, repeat('d', 64), 'stock',
    jsonb_build_array(jsonb_build_object('item', jsonb_build_object('name', 'Dichtband', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-DB-1', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 1)))->>'batch_id')::uuid;
  perform public.book_inventory_import(v_org, v_buero, v_batch);
  if not exists (
    select 1 from public.inventory_import_batches batch
    where batch.id = v_batch and batch.created_by = v_admin and batch.booked_by = v_buero
  ) then
    raise exception 'a booked batch must keep its previewer as created_by and its booker as booked_by';
  end if;
end;
$$;

-- 5. Only a manager of the batch's organization previews or books it.
select pg_temp.expect_refusal('a preview by an employee', $sql$
  select public.preview_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000002',
    'mitarbeiter.csv', '{}'::jsonb, null, 'stock', pg_temp.file_rows())
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a preview by a member of another organization', $sql$
  select public.preview_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000003',
    'fremd.csv', '{}'::jsonb, null, 'stock', pg_temp.file_rows())
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a preview in an unknown mode', $sql$
  select public.preview_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001',
    'modus.csv', '{}'::jsonb, null, 'transfer', pg_temp.file_rows())
$sql$, 'invalid_input');

do $$
declare
  v_foreign_batch uuid;
begin
  v_foreign_batch := (public.preview_inventory_import(
    '99200000-0000-4000-8000-000000000011', '99200000-0000-4000-8000-000000000003',
    'fremd.csv', '{}'::jsonb, null, 'stock',
    jsonb_build_array(jsonb_build_object('rejection', 'missing_name'))
  )->>'batch_id')::uuid;
  insert into preview_answers values ('foreign', jsonb_build_object('batch_id', v_foreign_batch));
end;
$$;

create temporary table before_refused_bookings as select * from pg_temp.org_counts;
select pg_temp.expect_refusal('a booking of another organization''s batch', format($sql$
  select public.book_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001', %L)
$sql$, (select answer->>'batch_id' from preview_answers where label = 'foreign')), 'batch_not_found');
select pg_temp.expect_refusal('a booking by an employee', format($sql$
  select public.book_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000002', %L)
$sql$, (select answer->>'batch_id' from preview_answers where label = 'stock')), 'not_authorized');
select pg_temp.expect_refusal('a booking of a batch without staged rows', $sql$
  select public.book_inventory_import(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000040')
$sql$, 'batch_not_found');

do $$
begin
  if (select to_jsonb(c) from pg_temp.org_counts c) is distinct from (select to_jsonb(b) from before_refused_bookings b)
    or not exists (select 1 from public.inventory_import_batches
      where id = (select (answer->>'batch_id')::uuid from preview_answers where label = 'foreign') and status = 'draft')
  then
    raise exception 'a refused booking must leave both organizations'' stock and batches unchanged';
  end if;

  -- The ledger rule holds: every stock level equals the sum of its movements.
  if exists (
    select 1 from public.inventory_stock_levels stock
    where stock.organization_id = '99200000-0000-4000-8000-000000000010'
      and stock.quantity_on_hand <> (select coalesce(sum(movement.quantity_delta), 0)
        from public.inventory_movements movement
        where movement.item_id = stock.item_id and movement.location_id = stock.location_id)
  ) then
    raise exception 'every stock level must equal the sum of its movements';
  end if;
end;
$$;

reset role;

-- 4e. A matched article is locked against a change of its unit, but not
--     against the foreign-key check of a concurrent movement: each match path
--     holds FOR NO KEY UPDATE until the row books, never FOR UPDATE, which
--     would deadlock with a booking that holds the stock row and inserts a
--     movement, and never only a share lock, which would let the unit change.
--     Each path is checked on its own article, which nothing else in this
--     transaction locks or updates (an update would hide the import's lock).
create extension if not exists pgrowlocks;
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Kugelhahn', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-KH-34', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 1),
    jsonb_build_object('item', jsonb_build_object('name', 'Thermostatkopf', 'item_type', 'material',
      'unit', 'piece', 'is_billable', true, 'global_minimum_stock', 0),
      'barcode', '4000000000077', 'location_name', 'Hauptlager', 'quantity', 1)
  );
  v_booking jsonb;
  v_path record;
  v_modes text[];
begin
  v_booking := public.book_inventory_import(v_org, v_admin, (public.preview_inventory_import(
    v_org, v_admin, 'sperren.csv', '{}'::jsonb, null, 'stock', v_rows)->>'batch_id')::uuid);
  if v_booking->'rows'->0 @> '{"outcome":"booked","matched_by":"internal_sku"}' is not true
    or v_booking->'rows'->1 @> '{"outcome":"booked","matched_by":"barcode"}' is not true
  then
    raise exception 'step 4e must book one row matched by Artikelnummer and one by barcode: %', v_booking->'rows';
  end if;
  for v_path in
    select * from (values
      ('Artikelnummer', '99200000-0000-4000-8000-000000000032'::uuid),
      ('barcode', '99200000-0000-4000-8000-000000000033'::uuid)
    ) path(name, item_id)
  loop
    v_modes := null;
    select locks.modes into v_modes
    from public.pgrowlocks('public.inventory_items') locks
    join public.inventory_items item on item.ctid = locks.locked_row
    where item.id = v_path.item_id;
    if v_modes is null or not ('For No Key Update' = any (v_modes)) or 'For Update' = any (v_modes) then
      raise exception 'an article matched by % must be locked FOR NO KEY UPDATE, and not FOR UPDATE: %',
        v_path.name, v_modes;
    end if;
  end loop;
end;
$$;

-- 4f. A deadlock or serialization failure is not the row's fault: it fails
--     the whole call instead of becoming a stored row failure, so no batch is
--     left behind and a repeated confirm books again. A test trigger raises
--     the deadlock SQLSTATE for one probe article; the transaction rolls back.
create function public.test_raise_deadlock_for_probe() returns trigger
language plpgsql as $$
begin
  if new.name = 'Deadlock-Probe' then
    raise exception 'test deadlock' using errcode = 'deadlock_detected';
  end if;
  return new;
end;
$$;
create trigger test_raise_deadlock_for_probe
before insert on public.inventory_items
for each row execute function public.test_raise_deadlock_for_probe();
do $$
declare
  v_org constant uuid := '99200000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99200000-0000-4000-8000-000000000001';
  v_rows constant jsonb := jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('name', 'Deadlock-Probe', 'item_type', 'material',
      'unit', 'piece', 'internal_sku', 'NR-DEADLOCK', 'is_billable', true, 'global_minimum_stock', 0),
      'location_name', 'Hauptlager', 'quantity', 1)
  );
  v_state text;
begin
  begin
    perform public.preview_inventory_import(v_org, v_admin, 'deadlock.csv', '{}'::jsonb, null, 'stock', v_rows);
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '40P01' then
    raise exception 'a deadlock must fail the whole preview, not become a row failure: %', coalesce(v_state, 'no error');
  end if;
  if exists (select 1 from public.inventory_import_batches where organization_id = v_org and file_name = 'deadlock.csv') then
    raise exception 'a preview that failed on a deadlock must leave no batch behind';
  end if;
end;
$$;
-- Disabled, not dropped: a DROP TRIGGER takes stack-wide locks (sql-test-stack-locks.test.ts).
alter table public.inventory_items disable trigger test_raise_deadlock_for_probe;

-- 6. Only the service role executes the functions; nobody executes the steps.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb)',
    'public.book_inventory_import(uuid, uuid, uuid)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'app_private.apply_inventory_import_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text, text, boolean)',
    'app_private.apply_inventory_import_rows(uuid, uuid, uuid, jsonb, text, text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
