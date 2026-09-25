import { createAdminClient } from './shared';

export type InventoryLedgerState = {
  quantityOnHand: number;
  movementTotal: number;
  lastQuantityAfter: number;
  movementCount: number;
};

// Snapshot of one item/location pair: the stored stock level plus what the
// movement ledger implies. A consistent ledger means quantityOnHand equals
// both the sum of all deltas and the last movement's quantity_after.
export async function getInventoryLedgerState(
  orgId: string,
  itemId: string,
  locationId: string,
): Promise<InventoryLedgerState> {
  const admin = createAdminClient();

  const { data: stockLevel, error: stockError } = await admin
    .from("inventory_stock_levels")
    .select("quantity_on_hand")
    .eq("organization_id", orgId)
    .eq("item_id", itemId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (stockError) {
    throw new Error(`Failed to read stock level: ${stockError.message}`);
  }

  const { data: movements, error: movementError } = await admin
    .from("inventory_movements")
    .select("quantity_delta, quantity_after, created_at")
    .eq("organization_id", orgId)
    .eq("item_id", itemId)
    .eq("location_id", locationId)
    .order("created_at", { ascending: true });
  if (movementError) {
    throw new Error(
      `Failed to read inventory movements: ${movementError.message}`,
    );
  }

  const rows = movements ?? [];
  const movementTotal = rows.reduce(
    (sum, row) => sum + Number(row.quantity_delta),
    0,
  );
  const lastRow = rows.at(-1);
  const lastQuantityAfter = lastRow ? Number(lastRow.quantity_after) : 0;

  return {
    quantityOnHand: Number(stockLevel?.quantity_on_hand ?? 0),
    movementTotal,
    lastQuantityAfter,
    movementCount: rows.length,
  };
}
