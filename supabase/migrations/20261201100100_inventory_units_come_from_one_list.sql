-- An article's unit is its base unit, and it comes from the one unit list in
-- lib/inventory/units.ts (lib/inventory/units.test.ts pins this check to that
-- list). A new or changed article with another unit is refused; this covers
-- save_inventory_item, import_inventory_row and every direct write. The check
-- is not validated against existing rows: an article saved before with a unit
-- outside the list keeps working, books stock and shows „Einheit prüfen“
-- until the office picks a unit from the list.
--
-- A unit code is never renamed or removed here, because offer and order lines
-- keep it; a unit that is no longer wanted is retired in units.ts and stays in
-- this check. Adding a unit replaces this check in a later migration.
-- @destructive: after release acce7e96d681: that build's article form offers only units from the list, and its CSV import counts a row the check refuses as failed, which is the intended refusal of an unknown unit.
alter table public.inventory_items
  add constraint inventory_items_unit_known check (
    unit in (
      'piece', 'meter', 'square_meter', 'cubic_meter', 'kilometer', 'liter', 'kilogram', 'hour', 'day',
      'flat_rate', 'roll', 'package', 'box', 'set', 'pair', 'sack', 'cartridge', 'bundle', 'pallet'
    )
  ) not valid;
