begin;

-- The inventory movement ledger: every movement records the stock before and
-- after it, the stored stock level always equals the sum of the movements and
-- the last movement's running total, and a take beyond the stock is refused
-- without writing a movement.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'inventory-ledger@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '98000000-0000-4000-8000-000000000002', 'Inventory ledger',
  '98000000-0000-4000-8000-000000000001', 'INVLEDGER'
);

insert into public.inventory_items (id, organization_id, name, item_type, unit, created_by)
values (
  '98000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000002',
  'Ledger item', 'material', 'piece', '98000000-0000-4000-8000-000000000001'
);

insert into public.inventory_locations (id, organization_id, name, location_type, created_by)
values (
  '98000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000002',
  'Ledger shelf', 'storage', '98000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_org constant uuid := '98000000-0000-4000-8000-000000000002';
  v_actor constant uuid := '98000000-0000-4000-8000-000000000001';
  v_item constant uuid := '98000000-0000-4000-8000-000000000003';
  v_location constant uuid := '98000000-0000-4000-8000-000000000004';
  v_taken record;
  v_returned record;
  v_stock numeric;
  v_total numeric;
  v_count integer;
  v_last_after numeric;
  v_refused boolean;
begin
  perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'initial_count', 10);

  select * into v_taken
  from public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_take', -3);
  if v_taken.quantity_before is distinct from 10 or v_taken.quantity_after is distinct from 7 then
    raise exception 'a job take must report the stock before (10) and after (7) the movement';
  end if;
  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  if v_stock is distinct from 7 then
    raise exception 'a job take must lower the stored stock level by its quantity';
  end if;

  select * into v_returned
  from public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_return', 3);

  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  select coalesce(sum(quantity_delta), 0), count(*) into v_total, v_count
  from public.inventory_movements
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  select quantity_after into v_last_after
  from public.inventory_movements
  where id = v_returned.movement_id;
  if v_stock is distinct from 10 or v_total is distinct from 10 or v_last_after is distinct from 10 or v_count is distinct from 3 then
    raise exception 'after take and return the stock level, the sum of the movements and the last running total must all be 10 over three movements';
  end if;

  begin
    perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_take', -11);
    v_refused := false;
  exception when others then
    v_refused := sqlerrm like '%inventory stock cannot go below zero%';
  end;
  if not v_refused then
    raise exception 'a take beyond the stock must be refused with the stock error';
  end if;

  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  select count(*) into v_count
  from public.inventory_movements
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  if v_stock is distinct from 10 or v_count is distinct from 3 then
    raise exception 'a refused take must leave the stock level and the movement ledger unchanged';
  end if;
end $$;

-- A return books against its material line under the line's lock: the
-- returned quantity never exceeds the taken quantity, whichever call checked
-- the line before, and a refused return writes no movement.
insert into public.projects (id, organization_id, name, created_by)
values (
  '98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000002',
  'Ledger project', '98000000-0000-4000-8000-000000000001'
);

insert into public.job_material_lines (id, organization_id, project_id, item_id, planned_quantity)
values (
  '98000000-0000-4000-8000-000000000006', '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000003', 4
);

do $$
declare
  v_org constant uuid := '98000000-0000-4000-8000-000000000002';
  v_actor constant uuid := '98000000-0000-4000-8000-000000000001';
  v_item constant uuid := '98000000-0000-4000-8000-000000000003';
  v_location constant uuid := '98000000-0000-4000-8000-000000000004';
  v_project constant uuid := '98000000-0000-4000-8000-000000000005';
  v_line constant uuid := '98000000-0000-4000-8000-000000000006';
  v_refusal text;
  v_returned numeric;
  v_stock numeric;
  v_count integer;
begin
  perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_take', -4, null, v_project, v_line);
  perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_return', 3, null, v_project, v_line);

  begin
    perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_return', 2, null, v_project, v_line);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'return_exceeds_taken' then
    raise exception 'a return beyond the line''s taken quantity must be refused with return_exceeds_taken, got %', v_refusal;
  end if;

  select returned_quantity into v_returned from public.job_material_lines where id = v_line;
  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  select count(*) into v_count from public.inventory_movements where job_material_line_id = v_line;
  if v_returned is distinct from 3 or v_stock is distinct from 9 or v_count is distinct from 2 then
    raise exception 'a refused return must leave the line, the stock level and the movement ledger unchanged';
  end if;

  perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_return', 1, null, v_project, v_line);
  select returned_quantity into v_returned from public.job_material_lines where id = v_line;
  if v_returned is distinct from 4 then
    raise exception 'a return up to the taken quantity must be booked';
  end if;

  begin
    update public.job_material_lines set returned_quantity = 5 where id = v_line;
    v_refusal := null;
  exception when check_violation then
    v_refusal := 'check_violation';
  end;
  if v_refusal is null then
    raise exception 'the line must refuse a returned quantity above its taken quantity';
  end if;

  select count(*) into v_count from public.inventory_movements where organization_id = v_org;
  begin
    perform public.record_inventory_movement(v_org, v_actor, v_item, v_location, 'job_return', 1, null, v_project,
      '98000000-0000-4000-8000-0000000000ff');
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'inventory movement material line must belong to same organization' then
    raise exception 'a return against a line outside the organization must be refused, got %', v_refusal;
  end if;
  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  if v_stock is distinct from 10 or (select count(*) from public.inventory_movements where organization_id = v_org) is distinct from v_count then
    raise exception 'a return refused for a foreign line must leave the stock level and the movement ledger unchanged';
  end if;
end $$;

-- A take books against its material line under the line's lock and only for
-- the item the caller read on the line: a line whose item changed since that
-- read refuses the take with no movement, no stock change and no taken
-- quantity, and an unchanged line still books.
insert into public.inventory_items (id, organization_id, name, item_type, unit, created_by)
values (
  '98000000-0000-4000-8000-000000000007', '98000000-0000-4000-8000-000000000002',
  'Swapped-in item', 'material', 'piece', '98000000-0000-4000-8000-000000000001'
);

insert into public.job_material_lines (id, organization_id, project_id, item_id, planned_quantity)
values (
  '98000000-0000-4000-8000-000000000008', '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000003', 2
);

do $$
declare
  v_org constant uuid := '98000000-0000-4000-8000-000000000002';
  v_actor constant uuid := '98000000-0000-4000-8000-000000000001';
  v_read_item constant uuid := '98000000-0000-4000-8000-000000000003';
  v_new_item constant uuid := '98000000-0000-4000-8000-000000000007';
  v_location constant uuid := '98000000-0000-4000-8000-000000000004';
  v_project constant uuid := '98000000-0000-4000-8000-000000000005';
  v_line constant uuid := '98000000-0000-4000-8000-000000000008';
  v_refusal text;
  v_taken numeric;
  v_read_stock numeric;
  v_new_stock numeric;
  v_count integer;
begin
  perform public.record_inventory_movement(v_org, v_actor, v_new_item, v_location, 'initial_count', 5);

  -- The caller read the line with its first item; a manager then changed the item.
  update public.job_material_lines set item_id = v_new_item where id = v_line;

  begin
    perform public.record_inventory_movement(v_org, v_actor, v_read_item, v_location, 'job_take', -2, null, v_project, v_line);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material_line_item_changed' then
    raise exception 'a take for an item the line no longer carries must be refused with material_line_item_changed, got %', v_refusal;
  end if;

  select taken_quantity into v_taken from public.job_material_lines where id = v_line;
  select quantity_on_hand into v_read_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_read_item and location_id = v_location;
  select quantity_on_hand into v_new_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_new_item and location_id = v_location;
  select count(*) into v_count from public.inventory_movements where job_material_line_id = v_line;
  if v_taken is distinct from 0 or v_read_stock is distinct from 10 or v_new_stock is distinct from 5 or v_count is distinct from 0 then
    raise exception 'a take refused for a changed item must leave the line, both stock levels and the movement ledger unchanged';
  end if;

  perform public.record_inventory_movement(v_org, v_actor, v_new_item, v_location, 'job_take', -2, null, v_project, v_line);
  select taken_quantity into v_taken from public.job_material_lines where id = v_line;
  select quantity_on_hand into v_new_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_new_item and location_id = v_location;
  if v_taken is distinct from 2 or v_new_stock is distinct from 3 then
    raise exception 'a take for the item the line carries must be booked on the line and the stock';
  end if;
end $$;

rollback;
