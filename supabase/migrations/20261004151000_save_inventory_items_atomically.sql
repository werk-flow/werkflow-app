-- Saving an inventory item and importing a CSV row are each one function call,
-- and so one transaction. The server actions upsertInventoryItem and
-- importInventoryRows in lib/inventory/actions.ts wrote the item, its primary
-- barcode and its first stock movement in separate statements: a barcode that
-- could not be attached was skipped silently, and a refused first count left
-- the item without its stock.
--
-- Division of work: the action establishes identity, the organization and the
-- manager role, and passes the server-resolved organization and actor. Each
-- function re-checks the actor's manager membership under a share lock, checks
-- every referenced row inside the organization, and raises the action failure
-- code of the first refusal, so nothing changes. The stock movement goes
-- through record_inventory_movement, which keeps the ledger rules: the movement
-- is appended, and the stock level moves with it.
--
-- Signals stay as before: inserts and updates of inventory_items,
-- inventory_item_barcodes, inventory_stock_levels and inventory_movements reach
-- the Realtime publication; the action revalidates the inventory path.

-- The actor is a current admin or buero member; the share lock holds the
-- membership until commit, so a removal or role change waits for this call.
create function app_private.lock_inventory_manager(p_organization_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;
end;
$$;

-- The supplier, category or Lager of that name in the organization, created
-- when missing. A blank name is no reference.
create function app_private.ensure_inventory_supplier(p_organization_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if v_name is null then
    return null;
  end if;
  insert into public.inventory_suppliers (organization_id, name)
  values (p_organization_id, v_name)
  on conflict (organization_id, lower(name)) do nothing
  returning id into v_id;
  if v_id is null then
    select supplier.id into v_id from public.inventory_suppliers supplier
    where supplier.organization_id = p_organization_id and lower(supplier.name) = lower(v_name);
  end if;
  return v_id;
end;
$$;

create function app_private.ensure_inventory_category(p_organization_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if v_name is null then
    return null;
  end if;
  insert into public.inventory_categories (organization_id, name, sort_order)
  values (p_organization_id, v_name, 100)
  on conflict (organization_id, lower(name)) do nothing
  returning id into v_id;
  if v_id is null then
    select category.id into v_id from public.inventory_categories category
    where category.organization_id = p_organization_id and lower(category.name) = lower(v_name);
  end if;
  return v_id;
end;
$$;

create function app_private.ensure_inventory_location(p_organization_id uuid, p_actor_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if v_name is null then
    return null;
  end if;
  select location.id into v_id from public.inventory_locations location
  where location.organization_id = p_organization_id and location.is_active
    and lower(location.name) = lower(v_name)
  order by location.parent_location_id nulls first, location.id
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.inventory_locations (organization_id, name, location_type, created_by)
  values (p_organization_id, v_name, 'room', p_actor_id)
  on conflict (organization_id, coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
    where is_active do nothing
  returning id into v_id;
  if v_id is null then
    select location.id into v_id from public.inventory_locations location
    where location.organization_id = p_organization_id and location.is_active
      and location.parent_location_id is null and lower(location.name) = lower(v_name);
  end if;
  return v_id;
end;
$$;

-- Makes the barcode the item's primary barcode. A barcode of another item of
-- the organization refuses with barcode_taken; the item's previous primary
-- barcode stays attached as a secondary one.
create function app_private.attach_primary_inventory_barcode(
  p_organization_id uuid,
  p_item_id uuid,
  p_barcode text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_owner_id uuid;
begin
  if v_barcode is null then
    return;
  end if;
  select barcode.item_id into v_owner_id from public.inventory_item_barcodes barcode
  where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
  for update;
  if v_owner_id is not null and v_owner_id <> p_item_id then
    raise exception 'barcode_taken';
  end if;

  update public.inventory_item_barcodes barcode
  set is_primary = false
  where barcode.organization_id = p_organization_id and barcode.item_id = p_item_id
    and barcode.is_primary and barcode.barcode_value <> v_barcode;

  if v_owner_id is null then
    insert into public.inventory_item_barcodes (organization_id, item_id, barcode_value, barcode_type, is_primary)
    values (p_organization_id, p_item_id, v_barcode, 'unknown', true);
  else
    update public.inventory_item_barcodes barcode
    set is_primary = true
    where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
      and not barcode.is_primary;
  end if;
end;
$$;

-- Creates (p_item_id null) or updates an item with its primary barcode and,
-- on a create, its first count, or refuses and changes nothing.
-- p_item carries the item columns the form edits; organization, creator and
-- id come from the parameters only.
-- Refusals: not_authorized, invalid_input, location_required_for_initial_stock,
-- item_not_found, category_not_found, supplier_not_found, location_not_found,
-- barcode_taken; record_inventory_movement raises its own stock errors.
-- Returns the saved item row.
create function public.save_inventory_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_item jsonb,
  p_supplier_name text,
  p_barcode text,
  p_initial_location_id uuid,
  p_initial_quantity numeric
)
returns public.inventory_items
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_quantity numeric := coalesce(p_initial_quantity, 0);
  v_supplier_id uuid;
  v_item public.inventory_items;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if v_quantity < 0 or (p_item_id is not null and v_quantity > 0) then
    raise exception 'invalid_input';
  end if;
  if v_quantity > 0 and p_initial_location_id is null then
    raise exception 'location_required_for_initial_stock';
  end if;

  if v_fields.category_id is not null then
    perform 1 from public.inventory_categories category
    where category.id = v_fields.category_id and category.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'category_not_found';
    end if;
  end if;
  if v_fields.supplier_id is not null then
    perform 1 from public.inventory_suppliers supplier
    where supplier.id = v_fields.supplier_id and supplier.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'supplier_not_found';
    end if;
    v_supplier_id := v_fields.supplier_id;
  else
    v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
  end if;
  if p_initial_location_id is not null then
    perform 1 from public.inventory_locations location
    where location.id = p_initial_location_id and location.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'location_not_found';
    end if;
  end if;

  if p_item_id is null then
    insert into public.inventory_items (
      organization_id, item_type, name, description, category_id, unit, internal_sku, manufacturer,
      supplier_id, supplier_article_number, purchase_price_cents, sale_price_cents, is_billable,
      global_minimum_stock, global_target_stock, track_quantity, track_individual_assets, notes, created_by
    ) values (
      p_organization_id, v_fields.item_type, v_fields.name, v_fields.description, v_fields.category_id,
      v_fields.unit, v_fields.internal_sku, v_fields.manufacturer, v_supplier_id,
      v_fields.supplier_article_number, v_fields.purchase_price_cents, v_fields.sale_price_cents,
      v_fields.is_billable, v_fields.global_minimum_stock, v_fields.global_target_stock,
      v_fields.track_quantity, v_fields.track_individual_assets, v_fields.notes, p_actor_id
    )
    returning * into v_item;
  else
    update public.inventory_items item
    set item_type = v_fields.item_type,
        name = v_fields.name,
        description = v_fields.description,
        category_id = v_fields.category_id,
        unit = v_fields.unit,
        internal_sku = v_fields.internal_sku,
        manufacturer = v_fields.manufacturer,
        supplier_id = v_supplier_id,
        supplier_article_number = v_fields.supplier_article_number,
        purchase_price_cents = v_fields.purchase_price_cents,
        sale_price_cents = v_fields.sale_price_cents,
        is_billable = v_fields.is_billable,
        global_minimum_stock = v_fields.global_minimum_stock,
        global_target_stock = v_fields.global_target_stock,
        track_quantity = v_fields.track_quantity,
        track_individual_assets = v_fields.track_individual_assets,
        notes = v_fields.notes
    where item.id = p_item_id and item.organization_id = p_organization_id
    returning * into v_item;
    if v_item.id is null then
      raise exception 'item_not_found';
    end if;
  end if;

  perform app_private.attach_primary_inventory_barcode(p_organization_id, v_item.id, p_barcode);

  if v_quantity > 0 then
    perform public.record_inventory_movement(
      p_organization_id, p_actor_id, v_item.id, p_initial_location_id, 'initial_count', v_quantity,
      null, null, null, null, 'Erstbestand beim Anlegen'
    );
  end if;

  return v_item;
end;
$$;

-- Books one CSV row: the item matched by internal SKU, then by barcode, or a
-- new item with the row's category and supplier (created by name when
-- missing); the row's barcode as the item's primary barcode; and a quantity
-- as a receipt on a matched item or as the first count of a new one, in the
-- row's Lager (created by name when missing). Everything or nothing.
-- Returns 'imported', or 'missing_location' for a row with a quantity but no
-- Lager: its item and barcode are saved and no stock is booked.
-- Refusals: not_authorized, invalid_input, batch_not_found, barcode_taken;
-- record_inventory_movement raises its own stock errors.
create function public.import_inventory_row(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_item jsonb,
  p_category_name text,
  p_supplier_name text,
  p_location_name text,
  p_barcode text,
  p_quantity numeric,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_sku text := nullif(btrim(coalesce(v_fields.internal_sku, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_quantity numeric := coalesce(p_quantity, 0);
  v_category_id uuid;
  v_supplier_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_matched boolean;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if v_quantity < 0 then
    raise exception 'invalid_input';
  end if;
  perform 1 from public.inventory_import_batches batch
  where batch.id = p_import_batch_id and batch.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'batch_not_found';
  end if;

  v_category_id := app_private.ensure_inventory_category(p_organization_id, p_category_name);
  v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
  v_location_id := app_private.ensure_inventory_location(p_organization_id, p_actor_id, p_location_name);

  if v_sku is not null then
    select item.id into v_item_id from public.inventory_items item
    where item.organization_id = p_organization_id and item.internal_sku = v_sku
    for update;
  end if;
  if v_item_id is null and v_barcode is not null then
    select barcode.item_id into v_item_id from public.inventory_item_barcodes barcode
    where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode;
  end if;
  v_matched := v_item_id is not null;

  if not v_matched then
    insert into public.inventory_items (
      organization_id, item_type, name, category_id, unit, internal_sku, manufacturer, supplier_id,
      supplier_article_number, purchase_price_cents, sale_price_cents, is_billable,
      global_minimum_stock, global_target_stock, notes, created_by
    ) values (
      p_organization_id, v_fields.item_type, v_fields.name, v_category_id, v_fields.unit, v_sku,
      v_fields.manufacturer, v_supplier_id, v_fields.supplier_article_number,
      v_fields.purchase_price_cents, v_fields.sale_price_cents, v_fields.is_billable,
      v_fields.global_minimum_stock, v_fields.global_target_stock, v_fields.notes, p_actor_id
    )
    returning id into v_item_id;
  end if;

  perform app_private.attach_primary_inventory_barcode(p_organization_id, v_item_id, v_barcode);

  if v_quantity = 0 then
    return 'imported';
  end if;
  if v_location_id is null then
    return 'missing_location';
  end if;
  perform public.record_inventory_movement(
    p_organization_id, p_actor_id, v_item_id, v_location_id,
    case when v_matched then 'stock_in' else 'initial_count' end, v_quantity,
    null, null, null, p_import_batch_id, p_reason
  );
  return 'imported';
end;
$$;

revoke all on function app_private.lock_inventory_manager(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.ensure_inventory_supplier(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.ensure_inventory_category(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.ensure_inventory_location(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.attach_primary_inventory_barcode(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_inventory_item(uuid, uuid, uuid, jsonb, text, text, uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.import_inventory_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.save_inventory_item(uuid, uuid, uuid, jsonb, text, text, uuid, numeric)
  to service_role;
grant execute on function public.import_inventory_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text)
  to service_role;
