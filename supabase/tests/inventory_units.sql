-- An article's unit comes from the one unit list (migration
-- 20261201100100_inventory_units_come_from_one_list.sql): the database refuses
-- a new or changed article with a unit outside the list, through
-- save_inventory_item and through a direct write, while an article stored
-- before with another unit still books stock.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('99200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'inventory-units-admin@example.test', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('99200000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg', '99200000-0000-4000-8000-000000000001',
 'INVUNITS');

insert into public.inventory_locations (id, organization_id, name, location_type, created_by) values
('99200000-0000-4000-8000-000000000020', '99200000-0000-4000-8000-000000000010', 'Hauptlager', 'storage',
 '99200000-0000-4000-8000-000000000001');

insert into public.inventory_items (id, organization_id, name, item_type, unit, created_by) values
('99200000-0000-4000-8000-000000000030', '99200000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm',
 'material', 'meter', '99200000-0000-4000-8000-000000000001');

-- An article stored before the check, with a unit outside the list: the
-- check is set aside for its insert and restored as the migration defines it.
do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(oid) into strict v_definition from pg_constraint
  where conrelid = 'public.inventory_items'::regclass and conname = 'inventory_items_unit_known';
  alter table public.inventory_items drop constraint inventory_items_unit_known;
  insert into public.inventory_items (id, organization_id, name, item_type, unit, created_by) values
  ('99200000-0000-4000-8000-000000000031', '99200000-0000-4000-8000-000000000010', 'Bogen 90° alt',
   'material', 'Bogen', '99200000-0000-4000-8000-000000000001');
  execute format('alter table public.inventory_items add constraint inventory_items_unit_known %s', v_definition);
end;
$$;

-- Runs the statement and expects a refusal by the unit check.
create function pg_temp.expect_unit_refusal(p_label text, p_statement text)
returns void
language plpgsql
as $$
begin
  execute p_statement;
  raise exception '% was not refused', p_label;
exception when check_violation then
  if sqlerrm not like '%inventory_items_unit_known%' then
    raise exception '% refused by another check: %', p_label, sqlerrm;
  end if;
end;
$$;
grant execute on function pg_temp.expect_unit_refusal(text, text) to service_role;

set local role service_role;

-- 1. A new article with a unit outside the list is refused, on save and on a direct insert.
select pg_temp.expect_unit_refusal(
  'save_inventory_item with an unknown unit on create',
  $sql$select public.save_inventory_item(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001', null,
    '{"name":"Muffe","item_type":"material","unit":"Muffe","is_billable":true,"global_minimum_stock":0,
      "track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0
  )$sql$
);
select pg_temp.expect_unit_refusal(
  'a direct insert with an unknown unit',
  $sql$insert into public.inventory_items (organization_id, name, item_type, unit)
    values ('99200000-0000-4000-8000-000000000010', 'Muffe', 'material', 'Muffe')$sql$
);

-- 2. A changed article with a unit outside the list is refused, on save and on a direct update.
select pg_temp.expect_unit_refusal(
  'save_inventory_item with an unknown unit on update',
  $sql$select public.save_inventory_item(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000030',
    '{"name":"Kupferrohr 15 mm","item_type":"material","unit":"Stange","is_billable":true,
      "global_minimum_stock":0,"track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0
  )$sql$
);
select pg_temp.expect_unit_refusal(
  'a direct update to an unknown unit',
  $sql$update public.inventory_items set unit = 'Stange'
    where id = '99200000-0000-4000-8000-000000000030'$sql$
);

-- 3. A unit from the list saves, including the units the list added.
do $$
declare
  v_item public.inventory_items;
begin
  v_item := public.save_inventory_item(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001', null,
    '{"name":"Anfahrt","item_type":"consumable","unit":"kilometer","is_billable":true,"global_minimum_stock":0,
      "track_quantity":false,"track_individual_assets":false}'::jsonb,
    null, null, null, 0
  );
  if v_item.unit <> 'kilometer' then
    raise exception 'a unit from the list must save';
  end if;
end;
$$;

-- 4. The article stored with another unit still books a movement, and a
-- save that picks a unit from the list repairs it.
do $$
declare
  v_stock numeric;
  v_item public.inventory_items;
begin
  perform public.record_inventory_movement(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000031', '99200000-0000-4000-8000-000000000020',
    'initial_count', 4, null, null, null, null, 'Erstbestand'
  );
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where item_id = '99200000-0000-4000-8000-000000000031'
    and location_id = '99200000-0000-4000-8000-000000000020';
  if v_stock is distinct from 4 then
    raise exception 'an article with a unit outside the list must still book stock, found %', v_stock;
  end if;

  v_item := public.save_inventory_item(
    '99200000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000031',
    '{"name":"Bogen 90° alt","item_type":"material","unit":"piece","is_billable":true,
      "global_minimum_stock":0,"track_quantity":true,"track_individual_assets":false}'::jsonb,
    null, null, null, 0
  );
  if v_item.unit <> 'piece' then
    raise exception 'a save with a unit from the list must repair the article';
  end if;
end;
$$;

rollback;
