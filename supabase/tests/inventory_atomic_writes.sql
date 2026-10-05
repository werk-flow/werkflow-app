-- Saving an inventory item and importing a CSV row each apply completely or
-- not at all (migration 20261004151000_save_inventory_items_atomically.sql):
-- the item, its primary barcode and its first stock movement commit together,
-- a refused later step leaves no item, barcode or movement behind, every
-- reference stays inside the organization, and only a manager of the
-- organization saves through the service role. An unplanned material take
-- creates its line and books the take together
-- (migration 20261004151100_take_unplanned_material_atomically.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('99100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'inventory-atomic-admin@example.test', '', now(), '{}', '{}', now(), now()),
('99100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'inventory-atomic-employee@example.test', '', now(), '{}', '{}', now(), now()),
('99100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'inventory-atomic-foreign@example.test', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('99100000-0000-4000-8000-000000000010', 'Inventory atomic', '99100000-0000-4000-8000-000000000001', 'INVATOMC'),
('99100000-0000-4000-8000-000000000011', 'Inventory foreign', '99100000-0000-4000-8000-000000000003', 'INVFORGN');
insert into public.organization_members (organization_id, user_id, role) values
('99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000002', 'employee');

insert into public.inventory_locations (id, organization_id, name, location_type, created_by) values
('99100000-0000-4000-8000-000000000020', '99100000-0000-4000-8000-000000000010', 'Atomic shelf', 'storage',
 '99100000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000021', '99100000-0000-4000-8000-000000000011', 'Foreign shelf', 'storage',
 '99100000-0000-4000-8000-000000000003');
insert into public.inventory_categories (id, organization_id, name) values
('99100000-0000-4000-8000-000000000022', '99100000-0000-4000-8000-000000000011', 'Foreign category');
insert into public.inventory_items (id, organization_id, name, item_type, unit, internal_sku, created_by) values
('99100000-0000-4000-8000-000000000030', '99100000-0000-4000-8000-000000000010', 'Existing pipe', 'material',
 'piece', 'SKU-EXIST', '99100000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000031', '99100000-0000-4000-8000-000000000011', 'Foreign pipe', 'material',
 'piece', null, '99100000-0000-4000-8000-000000000003');
insert into public.inventory_item_barcodes (organization_id, item_id, barcode_value, is_primary) values
('99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000030', 'CODE-TAKEN', true);
insert into public.inventory_import_batches (id, organization_id, file_name, created_by) values
('99100000-0000-4000-8000-000000000040', '99100000-0000-4000-8000-000000000010', 'bestand.csv',
 '99100000-0000-4000-8000-000000000001'),
('99100000-0000-4000-8000-000000000041', '99100000-0000-4000-8000-000000000011', 'fremd.csv',
 '99100000-0000-4000-8000-000000000003');

insert into public.projects (id, organization_id, name, project_number, created_by) values
('99100000-0000-4000-8000-000000000050', '99100000-0000-4000-8000-000000000010', 'Atomic project', 'ATOMIC-P',
 '99100000-0000-4000-8000-000000000001');
insert into public.jobs (id, organization_id, title, job_number, created_by, project_id) values
('99100000-0000-4000-8000-000000000051', '99100000-0000-4000-8000-000000000010', 'Assigned job', 'ATOMIC-1',
 '99100000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000050'),
('99100000-0000-4000-8000-000000000052', '99100000-0000-4000-8000-000000000010', 'Unassigned job', 'ATOMIC-2',
 '99100000-0000-4000-8000-000000000001', null),
('99100000-0000-4000-8000-000000000053', '99100000-0000-4000-8000-000000000011', 'Foreign job', 'FOREIGN-1',
 '99100000-0000-4000-8000-000000000003', null);
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000051',
 '99100000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000001');

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

-- The org's item, barcode and movement counts, to prove a refusal wrote nothing.
create view pg_temp.org_counts as
select
  (select count(*) from public.inventory_items where organization_id = '99100000-0000-4000-8000-000000000010') items,
  (select count(*) from public.inventory_item_barcodes where organization_id = '99100000-0000-4000-8000-000000000010') barcodes,
  (select count(*) from public.inventory_movements where organization_id = '99100000-0000-4000-8000-000000000010') movements,
  (select count(*) from public.inventory_categories where organization_id = '99100000-0000-4000-8000-000000000010') categories;
grant select on pg_temp.org_counts to service_role;

set local role service_role;

-- 1. A create commits the item, its primary barcode and its first count together.
do $$
declare
  v_org constant uuid := '99100000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99100000-0000-4000-8000-000000000001';
  v_shelf constant uuid := '99100000-0000-4000-8000-000000000020';
  v_item public.inventory_items;
  v_stock numeric;
  v_movement record;
begin
  v_item := public.save_inventory_item(
    v_org, v_admin, null,
    '{"name":"Kupferrohr","item_type":"material","unit":"meter","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    'Großhandel Nord', 'CODE-NEW', v_shelf, 5
  );
  if v_item.organization_id <> v_org or v_item.created_by <> v_admin or v_item.supplier_id is null then
    raise exception 'a create must save the item in the organization with its creator and its new supplier';
  end if;
  if not exists (
    select 1 from public.inventory_item_barcodes
    where item_id = v_item.id and barcode_value = 'CODE-NEW' and is_primary
  ) then
    raise exception 'a create must attach the barcode as the primary barcode';
  end if;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item.id and location_id = v_shelf;
  select movement_type, quantity_delta, quantity_before, quantity_after, actor_id into v_movement
  from public.inventory_movements where item_id = v_item.id;
  if v_stock <> 5 or v_movement.movement_type <> 'initial_count' or v_movement.quantity_delta <> 5
    or v_movement.quantity_before <> 0 or v_movement.quantity_after <> 5 or v_movement.actor_id <> v_admin
  then
    raise exception 'a create with a first count must book one initial_count movement of 5 and a stock level of 5';
  end if;

  -- An edit with a new barcode makes it primary and keeps the old one attached.
  v_item := public.save_inventory_item(
    v_org, v_admin, v_item.id,
    '{"name":"Kupferrohr 15","item_type":"material","unit":"meter","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, 'CODE-NEWER', null, 0
  );
  if v_item.name <> 'Kupferrohr 15'
    or (select count(*) from public.inventory_item_barcodes where item_id = v_item.id) <> 2
    or not exists (select 1 from public.inventory_item_barcodes
      where item_id = v_item.id and barcode_value = 'CODE-NEWER' and is_primary)
    or exists (select 1 from public.inventory_item_barcodes
      where item_id = v_item.id and barcode_value = 'CODE-NEW' and is_primary)
  then
    raise exception 'an edit must make the new barcode primary and keep the previous one as secondary';
  end if;
end;
$$;

-- 2. A refused later step leaves no item, barcode or movement behind.
create temporary table before_refusals as select * from pg_temp.org_counts;

select pg_temp.expect_refusal('a create with a barcode of another item', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001', null,
    '{"name":"Doppelt","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, 'CODE-TAKEN', '99100000-0000-4000-8000-000000000020', 3)
$sql$, 'barcode_taken');
select pg_temp.expect_refusal('a create whose first count the ledger refuses', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001', null,
    '{"name":"Ohne Bestand","item_type":"tool","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":false,"track_individual_assets":true}'::jsonb,
    null, 'CODE-UNTRACKED', '99100000-0000-4000-8000-000000000020', 2)
$sql$, 'inventory item is not available for stock movement');
select pg_temp.expect_refusal('a first count without a Lager', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001', null,
    '{"name":"Ohne Lager","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 2)
$sql$, 'location_required_for_initial_stock');
-- The row matches the existing item by SKU, but its barcode belongs to the item
-- created above; the category the row names would be created first.
select pg_temp.expect_refusal('an import row whose barcode belongs to another item', $sql$
  select public.import_inventory_row(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000040',
    '{"name":"Existing pipe","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "internal_sku":"SKU-EXIST"}'::jsonb,
    'Neue Kategorie', null, 'Atomic shelf', 'CODE-NEW', 4, 'CSV-Import: bestand.csv')
$sql$, 'barcode_taken');

do $$
begin
  if (select row(items, barcodes, movements, categories) from pg_temp.org_counts)
    is distinct from (select row(items, barcodes, movements, categories) from before_refusals)
  then
    raise exception 'a refused save or import row must leave items, barcodes, movements and categories unchanged';
  end if;
end;
$$;

-- 3. References and the actor stay inside the organization and its managers.
select pg_temp.expect_refusal('a category of another organization', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001', null,
    '{"name":"Fremd","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false,
      "category_id":"99100000-0000-4000-8000-000000000022"}'::jsonb,
    null, null, null, 0)
$sql$, 'category_not_found');
select pg_temp.expect_refusal('a Lager of another organization', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001', null,
    '{"name":"Fremd","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, '99100000-0000-4000-8000-000000000021', 1)
$sql$, 'location_not_found');
select pg_temp.expect_refusal('an edit of another organization''s item', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000031',
    '{"name":"Übernommen","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0)
$sql$, 'item_not_found');
select pg_temp.expect_refusal('a save by a member of another organization', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000003', null,
    '{"name":"Fremd","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a save by an employee', $sql$
  select public.save_inventory_item(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000002', null,
    '{"name":"Mitarbeiter","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('an import into another organization''s batch', $sql$
  select public.import_inventory_row(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000041',
    '{"name":"Fremd","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0}'::jsonb,
    null, null, null, null, 0, null)
$sql$, 'batch_not_found');

-- 4. Import rows: a new item's quantity is its first count, a matched item's a
--    receipt, a row without a Lager keeps its item and books nothing.
do $$
declare
  v_org constant uuid := '99100000-0000-4000-8000-000000000010';
  v_admin constant uuid := '99100000-0000-4000-8000-000000000001';
  v_batch constant uuid := '99100000-0000-4000-8000-000000000040';
  v_existing constant uuid := '99100000-0000-4000-8000-000000000030';
  v_outcome text;
  v_new_item uuid;
  v_movements_before integer;
begin
  v_outcome := public.import_inventory_row(
    v_org, v_admin, v_batch,
    '{"name":"Muffe","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "internal_sku":"SKU-MUFFE"}'::jsonb,
    'Fittings', 'Großhandel Süd', 'Neues Regal', 'CODE-MUFFE', 7, 'CSV-Import: bestand.csv'
  );
  select id into v_new_item from public.inventory_items where organization_id = v_org and internal_sku = 'SKU-MUFFE';
  if v_outcome <> 'imported' or v_new_item is null
    or not exists (select 1 from public.inventory_item_barcodes
      where item_id = v_new_item and barcode_value = 'CODE-MUFFE' and is_primary)
    or not exists (select 1 from public.inventory_movements movement
      join public.inventory_locations location on location.id = movement.location_id
      where movement.item_id = v_new_item and movement.movement_type = 'initial_count'
        and movement.quantity_delta = 7 and movement.import_batch_id = v_batch
        and location.name = 'Neues Regal' and location.organization_id = v_org)
    or not exists (select 1 from public.inventory_items item
      join public.inventory_categories category on category.id = item.category_id
      join public.inventory_suppliers supplier on supplier.id = item.supplier_id
      where item.id = v_new_item and category.name = 'Fittings' and supplier.name = 'Großhandel Süd')
  then
    raise exception 'a new import row must create the item with category, supplier, Lager, primary barcode and a first count of 7';
  end if;

  v_outcome := public.import_inventory_row(
    v_org, v_admin, v_batch,
    '{"name":"Existing pipe","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0,
      "internal_sku":"SKU-EXIST"}'::jsonb,
    null, null, 'Atomic shelf', null, 3, 'CSV-Import: bestand.csv'
  );
  if v_outcome <> 'imported' or (select count(*) from public.inventory_items
      where organization_id = v_org and internal_sku = 'SKU-EXIST') <> 1
    or not exists (select 1 from public.inventory_movements
      where item_id = v_existing and movement_type = 'stock_in' and quantity_delta = 3)
  then
    raise exception 'a matched import row must book a receipt on the existing item without a duplicate';
  end if;

  select count(*) into v_movements_before from public.inventory_movements where organization_id = v_org;
  v_outcome := public.import_inventory_row(
    v_org, v_admin, v_batch,
    '{"name":"Ohne Lager","item_type":"material","unit":"piece","is_billable":true,"global_minimum_stock":0}'::jsonb,
    null, null, null, 'CODE-NOLAGER', 2, 'CSV-Import: bestand.csv'
  );
  if v_outcome <> 'missing_location'
    or not exists (select 1 from public.inventory_items item
      join public.inventory_item_barcodes barcode on barcode.item_id = item.id
      where item.organization_id = v_org and item.name = 'Ohne Lager' and barcode.barcode_value = 'CODE-NOLAGER')
    or (select count(*) from public.inventory_movements where organization_id = v_org) <> v_movements_before
  then
    raise exception 'an import row without a Lager must keep its item and barcode and book nothing';
  end if;

  -- The ledger rule holds: every stock level equals the sum of its movements.
  if exists (
    select 1 from public.inventory_stock_levels stock
    where stock.organization_id = v_org
      and stock.quantity_on_hand <> (select coalesce(sum(movement.quantity_delta), 0)
        from public.inventory_movements movement
        where movement.item_id = stock.item_id and movement.location_id = stock.location_id)
  ) then
    raise exception 'every stock level must equal the sum of its movements';
  end if;
end;
$$;

-- 5. An unplanned take creates its line and books the take together; a
--    refused take leaves no line behind (migration 20261004151100). The
--    existing pipe holds 3 on the Atomic shelf after step 4.
do $$
declare
  v_org constant uuid := '99100000-0000-4000-8000-000000000010';
  v_employee constant uuid := '99100000-0000-4000-8000-000000000002';
  v_admin constant uuid := '99100000-0000-4000-8000-000000000001';
  v_item constant uuid := '99100000-0000-4000-8000-000000000030';
  v_shelf constant uuid := '99100000-0000-4000-8000-000000000020';
  v_job constant uuid := '99100000-0000-4000-8000-000000000051';
  v_project constant uuid := '99100000-0000-4000-8000-000000000050';
  v_after numeric;
begin
  v_after := public.take_unplanned_inventory_material(
    v_org, v_employee, v_job, null, v_item, v_shelf, 1, 'Für Auftrag entnommen', 'Nachgekauft'
  );
  if v_after <> 2 or not exists (
    select 1 from public.job_material_lines line
    join public.inventory_movements movement on movement.job_material_line_id = line.id
    where line.job_id = v_job and line.project_id = v_project and line.item_id = v_item
      and line.is_unplanned and line.taken_quantity = 1 and line.notes = 'Nachgekauft'
      and line.preferred_location_id = v_shelf and line.created_by = v_employee
      and movement.movement_type = 'job_take' and movement.quantity_delta = -1
      and movement.job_id = v_job and movement.project_id = v_project
  ) then
    raise exception 'an assigned employee''s unplanned take must create the line with the job''s project and book the take on it';
  end if;

  v_after := public.take_unplanned_inventory_material(
    v_org, v_admin, null, v_project, v_item, v_shelf, 1, 'Für Projekt entnommen', null
  );
  if v_after <> 1 or not exists (
    select 1 from public.job_material_lines line
    where line.job_id is null and line.project_id = v_project and line.is_unplanned and line.taken_quantity = 1
  ) then
    raise exception 'a manager''s unplanned project take must create a direct project line and book the take';
  end if;
end;
$$;

create temporary table lines_before_refused_takes as
select count(*) lines from public.job_material_lines where organization_id = '99100000-0000-4000-8000-000000000010';

select pg_temp.expect_refusal('a take beyond the stock', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000051', null, '99100000-0000-4000-8000-000000000030',
    '99100000-0000-4000-8000-000000000020', 10, null, null)
$sql$, 'inventory stock cannot go below zero');
select pg_temp.expect_refusal('a take on an unassigned job by an employee', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000002',
    '99100000-0000-4000-8000-000000000052', null, '99100000-0000-4000-8000-000000000030',
    '99100000-0000-4000-8000-000000000020', 1, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a project take by an employee', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000002',
    null, '99100000-0000-4000-8000-000000000050', '99100000-0000-4000-8000-000000000030',
    '99100000-0000-4000-8000-000000000020', 1, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a take on another organization''s job', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000053', null, '99100000-0000-4000-8000-000000000030',
    '99100000-0000-4000-8000-000000000020', 1, null, null)
$sql$, 'job_not_found');
select pg_temp.expect_refusal('a take of another organization''s item', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000051', null, '99100000-0000-4000-8000-000000000031',
    '99100000-0000-4000-8000-000000000020', 1, null, null)
$sql$, 'item_not_found');
select pg_temp.expect_refusal('a take from another organization''s Lager', $sql$
  select public.take_unplanned_inventory_material(
    '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000051', null, '99100000-0000-4000-8000-000000000030',
    '99100000-0000-4000-8000-000000000021', 1, null, null)
$sql$, 'location_not_found');

do $$
begin
  if (select count(*) from public.job_material_lines where organization_id = '99100000-0000-4000-8000-000000000010')
    <> (select lines from lines_before_refused_takes)
  then
    raise exception 'a refused unplanned take must leave no material line behind';
  end if;
end;
$$;

reset role;

-- 6. Only the service role executes the functions; nobody executes the steps.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.save_inventory_item(uuid, uuid, uuid, jsonb, text, text, uuid, numeric)',
    'public.import_inventory_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text)',
    'public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text)'
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
    'app_private.lock_inventory_manager(uuid, uuid)',
    'app_private.ensure_inventory_supplier(uuid, text)',
    'app_private.ensure_inventory_category(uuid, text)',
    'app_private.ensure_inventory_location(uuid, uuid, text)',
    'app_private.attach_primary_inventory_barcode(uuid, uuid, text)'
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
