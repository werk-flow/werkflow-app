-- An article's unit comes from the one unit list, and it changes only while
-- the article has no stock or history (werk-flow/werkflow-planning#396,
-- migration 20261204100000_refuse_an_article_unit_outside_the_list.sql). The
-- database refuses a new or changed unit outside the list, through
-- save_inventory_item and through a direct write; an article stored earlier
-- with another unit still books stock, takes a price and saves, and may be set
-- once to a unit from the list.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('39600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'inventory-units-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Sonnenberg"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('39600000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '39600000-0000-4000-8000-000000000001', 'INVUNIT1');

insert into public.inventory_locations (id, organization_id, name, location_type) values
('39600000-0000-4000-8000-000000000020', '39600000-0000-4000-8000-000000000010', 'Hauptlager', 'storage');

insert into public.projects (id, organization_id, name, created_by) values
('39600000-0000-4000-8000-000000000021', '39600000-0000-4000-8000-000000000010',
 'Bad Musterstraße', '39600000-0000-4000-8000-000000000001');

-- 30 pipe with stock, 31 fitting on a job material line, 32 valve with neither,
-- 33 sleeve with a pack size and stock, 35 elbow whose stock went back to 0.
insert into public.inventory_items (id, organization_id, name, item_type, unit) values
('39600000-0000-4000-8000-000000000030', '39600000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm', 'material', 'meter'),
('39600000-0000-4000-8000-000000000031', '39600000-0000-4000-8000-000000000010', 'Pressfitting 15 mm', 'material', 'piece'),
('39600000-0000-4000-8000-000000000032', '39600000-0000-4000-8000-000000000010', 'Kugelhahn 1/2"', 'material', 'piece'),
('39600000-0000-4000-8000-000000000033', '39600000-0000-4000-8000-000000000010', 'Schiebemuffe 15 mm', 'material', 'piece'),
('39600000-0000-4000-8000-000000000035', '39600000-0000-4000-8000-000000000010', 'Pressbogen 15 mm', 'material', 'piece');

insert into public.job_material_lines (organization_id, project_id, item_id, planned_quantity) values
('39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000021',
 '39600000-0000-4000-8000-000000000031', 4);

-- 34: an article stored before the database guarded the unit, with a unit
-- outside the list. The seed bypasses the guard trigger for this one insert.
set local session_replication_role = replica;
insert into public.inventory_items (id, organization_id, name, item_type, unit) values
('39600000-0000-4000-8000-000000000034', '39600000-0000-4000-8000-000000000010', 'Bogen 90° alt', 'material', 'Bogen');
set local session_replication_role = origin;

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

-- The save of one article with the given unit and name; null creates one.
create function pg_temp.save_item(p_item_id uuid, p_name text, p_unit text) returns public.inventory_items
language sql as $$
  select public.save_inventory_item(
    '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001', p_item_id,
    jsonb_build_object('name', p_name, 'item_type', 'material', 'unit', p_unit, 'is_billable', true,
      'global_minimum_stock', 0, 'track_quantity', true, 'track_individual_assets', false),
    null, null, null, 0
  );
$$;
grant execute on function pg_temp.save_item(uuid, text, text) to service_role;

set local role service_role;

select public.record_inventory_movement(
  '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000030', '39600000-0000-4000-8000-000000000020', 'initial_count', 12
);
select public.record_inventory_movement(
  '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000033', '39600000-0000-4000-8000-000000000020', 'initial_count', 3
);
select public.record_inventory_movement(
  '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000035', '39600000-0000-4000-8000-000000000020', 'initial_count', 2
);
select public.record_inventory_movement(
  '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000035', '39600000-0000-4000-8000-000000000020', 'stock_out', -2
);
select public.save_inventory_item_supplier(
  '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
  '39600000-0000-4000-8000-000000000033', 'piece', null, null, 'Großhandel Nordrohr', 'NR-SM15', 'package',
  1, 10, true
);

-- 1. A new article with a unit outside the list is refused, on save and on a direct insert.
select pg_temp.expect_refusal('a save that creates an article with an unknown unit',
  $sql$select pg_temp.save_item(null, 'Muffe', 'Muffe')$sql$, 'unit_unknown');
select pg_temp.expect_refusal('a direct insert with an unknown unit',
  $sql$insert into public.inventory_items (organization_id, name, item_type, unit)
    values ('39600000-0000-4000-8000-000000000010', 'Muffe', 'material', 'Stk.')$sql$, 'unit_unknown');

-- 2. A changed unit outside the list is refused, on save and on a direct update.
select pg_temp.expect_refusal('a save that changes the unit to an unknown one',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000032', 'Kugelhahn 1/2"', 'Stange')$sql$,
  'unit_unknown');
select pg_temp.expect_refusal('a direct update to an unknown unit',
  $sql$update public.inventory_items set unit = 'Ring' where id = '39600000-0000-4000-8000-000000000032'$sql$,
  'unit_unknown');

-- 3. Every unit from the list saves, the added Stange and Ring included, and
-- an article without stock or history changes its unit.
do $$
declare
  v_unit text;
  v_item public.inventory_items;
begin
  foreach v_unit in array array['rod', 'coil', 'kilometer', 'flat_rate'] loop
    v_item := pg_temp.save_item(null, 'Artikel in ' || v_unit, v_unit);
    if v_item.unit is distinct from v_unit then
      raise exception 'a new article in % must save', v_unit;
    end if;
  end loop;

  v_item := pg_temp.save_item('39600000-0000-4000-8000-000000000032', 'Kugelhahn 1/2"', 'set');
  if v_item.unit is distinct from 'set' then
    raise exception 'an article without stock or history must change its unit';
  end if;
end;
$$;

-- 4. An article with stock, movements or a material line keeps its unit, on
-- save and on a direct update; a save that keeps the unit changes every other
-- field.
select pg_temp.expect_refusal('a unit change on an article with stock',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000030', 'Kupferrohr 15 mm', 'rod')$sql$,
  'unit_in_use');
select pg_temp.expect_refusal('a direct unit change on an article with stock',
  $sql$update public.inventory_items set unit = 'rod' where id = '39600000-0000-4000-8000-000000000030'$sql$,
  'unit_in_use');
do $$
begin
  if exists (
    select 1 from public.inventory_stock_levels stock
    where stock.organization_id = '39600000-0000-4000-8000-000000000010'
      and stock.item_id = '39600000-0000-4000-8000-000000000035' and stock.quantity_on_hand <> 0
  ) then
    raise exception 'the elbow must hold no stock, so only its movements keep its unit';
  end if;
end;
$$;
select pg_temp.expect_refusal('a unit change on an article with movements and no stock',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000035', 'Pressbogen 15 mm', 'package')$sql$,
  'unit_in_use');
select pg_temp.expect_refusal('a unit change on an article on a job material line',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000031', 'Pressfitting 15 mm', 'package')$sql$,
  'unit_in_use');
-- The pack size refusal of migration 20261203150000 still answers first.
select pg_temp.expect_refusal('a unit change on an article sold in packs',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000033', 'Schiebemuffe 15 mm', 'meter')$sql$,
  'unit_has_pack_sizes');
do $$
declare
  v_item public.inventory_items;
begin
  v_item := pg_temp.save_item('39600000-0000-4000-8000-000000000030', 'Kupferrohr 15 mm hart', 'meter');
  if v_item.name is distinct from 'Kupferrohr 15 mm hart' or v_item.unit is distinct from 'meter' then
    raise exception 'a save that keeps the unit must change the other fields of an article with stock';
  end if;
end;
$$;

-- 5. The article stored with another unit books stock, takes a price and
-- saves its other fields; another unknown unit is refused; one unit from the
-- list repairs it although it has stock, and then it keeps that unit.
do $$
declare
  v_stock numeric;
  v_item public.inventory_items;
begin
  perform public.record_inventory_movement(
    '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
    '39600000-0000-4000-8000-000000000034', '39600000-0000-4000-8000-000000000020', 'initial_count', 4
  );
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = '39600000-0000-4000-8000-000000000010'
    and item_id = '39600000-0000-4000-8000-000000000034';
  if v_stock is distinct from 4::numeric then
    raise exception 'an article with a unit outside the list must still book stock, found %', v_stock;
  end if;

  perform public.add_inventory_item_price(
    '39600000-0000-4000-8000-000000000010', '39600000-0000-4000-8000-000000000001',
    '39600000-0000-4000-8000-000000000034', 'Bogen', 'purchase', 250, 1,
    (now() at time zone 'Europe/Berlin')::date
  );
  v_item := pg_temp.save_item('39600000-0000-4000-8000-000000000034', 'Bogen 90° 15 mm', 'Bogen');
  if v_item.name is distinct from 'Bogen 90° 15 mm' or v_item.purchase_price_cents is distinct from 250 then
    raise exception 'an article with a unit outside the list must take a price and save its other fields';
  end if;
end;
$$;
select pg_temp.expect_refusal('a repair to another unknown unit',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000034', 'Bogen 90° 15 mm', 'Winkel')$sql$,
  'unit_unknown');
do $$
declare
  v_item public.inventory_items;
begin
  v_item := pg_temp.save_item('39600000-0000-4000-8000-000000000034', 'Bogen 90° 15 mm', 'piece');
  if v_item.unit is distinct from 'piece' then
    raise exception 'a save with a unit from the list must repair the article although it has stock';
  end if;
end;
$$;
select pg_temp.expect_refusal('a second unit change after the repair',
  $sql$select pg_temp.save_item('39600000-0000-4000-8000-000000000034', 'Bogen 90° 15 mm', 'package')$sql$,
  'unit_in_use');

rollback;
