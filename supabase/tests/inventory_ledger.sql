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
  if v_taken.quantity_before <> 10 or v_taken.quantity_after <> 7 then
    raise exception 'a job take must report the stock before (10) and after (7) the movement';
  end if;
  select quantity_on_hand into v_stock
  from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_item and location_id = v_location;
  if v_stock <> 7 then
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
  if v_stock <> 10 or v_total <> 10 or v_last_after <> 10 or v_count <> 3 then
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
  if v_stock <> 10 or v_count <> 3 then
    raise exception 'a refused take must leave the stock level and the movement ledger unchanged';
  end if;
end $$;

rollback;
