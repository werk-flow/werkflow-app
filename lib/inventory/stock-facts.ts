import { formatInventoryQuantity, type InventoryStockStatus } from './types';

// `list_inventory_page` computes the same status in SQL for the filter and the
// summary counts; both must change together.

/**
 * An item's `Verfügbar` and status. `Verfügbar` is total stock minus open
 * planned demand and turns negative when the demand exceeds the stock; that
 * shortfall outranks every other status, because a planned job cannot get
 * its material.
 */
export function inventoryStockFacts(
  item: { trackQuantity: boolean; globalMinimumStock: number },
  totalOnHand: number,
  plannedQuantity: number,
): { availableQuantity: number; stockStatus: InventoryStockStatus } {
  const onHand = toStoredQuantity(totalOnHand);
  const availableQuantity = toStoredQuantity(onHand - toStoredQuantity(plannedQuantity));
  return { availableQuantity, stockStatus: stockStatus(item, onHand, availableQuantity) };
}

// Quantities are `numeric(12,3)`, which SQL sums exactly. Summed in floating
// point, 0,1 + 0,2 planned against 0,3 in stock would leave a shortfall of
// 5,6e-17 that the SQL status does not see. `+ 0` turns -0 into 0.
function toStoredQuantity(quantity: number): number {
  return Math.round(quantity * 1000) / 1000 + 0;
}

function stockStatus(
  item: { trackQuantity: boolean; globalMinimumStock: number },
  totalOnHand: number,
  availableQuantity: number,
): InventoryStockStatus {
  if (!item.trackQuantity) return 'in_stock';
  if (availableQuantity < 0) return 'shortfall';
  if (totalOnHand <= 0) return 'out_of_stock';
  if (item.globalMinimumStock > 0 && totalOnHand <= item.globalMinimumStock) return 'low_stock';
  return 'in_stock';
}

/** `Verfügbar` in words: the quantity, or „Fehlmenge n“ when planned demand exceeds the stock. */
export function formatAvailableQuantity(availableQuantity: number, unit: string): string {
  return availableQuantity < 0
    ? `Fehlmenge ${formatInventoryQuantity(-availableQuantity, unit)}`
    : formatInventoryQuantity(availableQuantity, unit);
}
