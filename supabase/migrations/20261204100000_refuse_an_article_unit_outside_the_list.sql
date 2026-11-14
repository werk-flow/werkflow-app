-- The database refuses an article unit outside the unit list, and a unit change
-- on an article with stock or history (werk-flow/werkflow-planning#396).
--
-- 1. An article's unit is its base unit, and it comes from the one unit list in
--    lib/inventory/units.ts; lib/inventory/units.test.ts pins the list below to
--    that file. A new article, or a changed unit, outside the list is refused
--    with unit_unknown. This covers save_inventory_item, the CSV import and
--    every direct write.
-- 2. A trigger, not a CHECK: PostgreSQL checks a CHECK on every update of a
--    row, also one marked NOT VALID, so an article saved earlier with another
--    unit could no longer take a new price (the price columns sync updates the
--    row) or any other change. The trigger runs only on an insert and on a
--    changed unit, so that article keeps working, books stock and shows
--    „Einheit prüfen“ until the office picks a unit from the list.
-- 3. An article's unit changes only while the article has no stock, movement,
--    job material line or recorded use: each of them counts in the unit, and a
--    change would relabel every recorded quantity. The refusal is
--    unit_in_use. One exception: an article whose stored unit is outside the
--    list may be set once to a unit from the list. save_inventory_item still
--    refuses a change while a supplier sells the article in packs
--    (unit_has_pack_sizes, migration 20261203150000) before this rule runs.
--    save_inventory_item locks the article before its update, so a take or a
--    material line another session commits meanwhile counts.
-- 4. A unit code is never renamed or removed here, because offer and order
--    lines keep it; a unit that is no longer wanted is retired in units.ts and
--    stays in this list. Adding a unit replaces this function. This migration
--    adds „Stange“ (rod) and „Ring“ (coil) for supplier pack sizes.

create function app_private.guard_inventory_item_unit()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_units constant text[] := array[
    'piece', 'meter', 'square_meter', 'cubic_meter', 'kilometer', 'liter', 'kilogram', 'hour', 'day',
    'flat_rate', 'roll', 'package', 'box', 'set', 'pair', 'sack', 'cartridge', 'bundle', 'pallet',
    'rod', 'coil'
  ];
begin
  if tg_op = 'UPDATE' and new.unit is not distinct from old.unit then
    return new;
  end if;
  if not (new.unit = any (v_units)) then
    raise exception 'unit_unknown' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.unit = any (v_units) and (
    exists (
      select 1 from public.inventory_movements movement
      where movement.item_id = old.id and movement.organization_id = old.organization_id
    )
    or exists (
      select 1 from public.inventory_stock_levels stock
      where stock.item_id = old.id and stock.organization_id = old.organization_id
        and stock.quantity_on_hand <> 0
    )
    or exists (
      select 1 from public.job_material_lines line
      where line.item_id = old.id and line.organization_id = old.organization_id
    )
    or exists (
      select 1 from public.job_material_use_events use_event
      where use_event.item_id = old.id and use_event.organization_id = old.organization_id
    )
  ) then
    raise exception 'unit_in_use' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_inventory_item_unit() from public, anon, authenticated, service_role;

-- @destructive: after release 55088f06f04b: that build's article form, template quick create and CSV import write only units from the list, and the unit change this refuses on an article with stock or history is the intended refusal
create trigger inventory_items_unit_guard
before insert or update of unit on public.inventory_items
for each row execute function app_private.guard_inventory_item_unit();
