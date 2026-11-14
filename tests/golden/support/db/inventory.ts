import { createHash } from 'node:crypto';
import { createAdminClient, persisted, type Persisted } from './shared';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';

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
    .from('inventory_stock_levels')
    .select('quantity_on_hand')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (stockError) {
    throw new Error(`Failed to read stock level: ${stockError.message}`);
  }

  const { data: movements, error: movementError } = await admin
    .from('inventory_movements')
    .select('quantity_delta, quantity_after, created_at')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .order('created_at', { ascending: true });
  if (movementError) {
    throw new Error(`Failed to read inventory movements: ${movementError.message}`);
  }

  const rows = movements ?? [];
  const movementTotal = rows.reduce((sum, row) => sum + Number(row.quantity_delta), 0);
  const lastRow = rows.at(-1);
  const lastQuantityAfter = lastRow ? Number(lastRow.quantity_after) : 0;

  return {
    quantityOnHand: Number(stockLevel?.quantity_on_hand ?? 0),
    movementTotal,
    lastQuantityAfter,
    movementCount: rows.length,
  };
}

export type PersistedInventoryLocation = Persisted<{ id: string; name: string; isActive: boolean }>;

/** The Lager a dialog just saved, read back by its test-specific name. */
export async function getInventoryLocationByName(
  orgId: string,
  name: string,
): Promise<PersistedInventoryLocation> {
  const { data, error } = await createAdminClient()
    .from('inventory_locations')
    .select('id, name, is_active')
    .eq('organization_id', orgId)
    .eq('name', name)
    .single();
  if (error) throw new Error(`Inventory location ${name} lookup failed: ${error.message}`);
  return persisted({ id: data.id, name: data.name, isActive: data.is_active });
}

/**
 * A CSV import of this file content that an earlier booking closed, so the
 * import dialog warns before the same file again. The hash is the SHA-256 of
 * the bytes, as the browser computes it.
 */
export async function seedBookedImportBatch(input: {
  orgId: string;
  actorId: string;
  fileName: string;
  content: Buffer;
}): Promise<void> {
  await createAdminClient()
    .from('inventory_import_batches')
    .insert({
      organization_id: input.orgId,
      file_name: input.fileName,
      status: 'imported',
      created_by: input.actorId,
      content_hash: createHash('sha256').update(input.content).digest('hex'),
      completed_at: new Date().toISOString(),
    })
    .throwOnError();
}

/**
 * An article of „Haustechnik Sonnenberg“ with two made-up wholesalers and a
 * price history, written as the article dialog writes them: a purchase price
 * replaced on a later day, a sale price per 10 m and a coming purchase price.
 * Returns the article id.
 */
export async function seedArticleWithTerms(input: {
  orgId: string;
  actorId: string;
  name: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data: item, error } = await admin.rpc(
    'save_inventory_item',
    rpcArgs('save_inventory_item', {
      p_organization_id: input.orgId,
      p_actor_id: input.actorId,
      p_item_id: null,
      p_item: {
        item_type: 'material',
        name: input.name,
        unit: 'meter',
        is_billable: true,
        global_minimum_stock: 0,
        track_quantity: true,
        track_individual_assets: false,
      },
      p_supplier_name: null,
      p_barcode: null,
      p_initial_location_id: null,
      p_initial_quantity: 0,
    }),
  );
  if (error || !item) throw new Error(`Failed to seed article: ${error?.message ?? 'no row'}`);
  const references = [
    {
      supplier: 'Großhandel Nordrohr',
      number: `NR-${item.id.slice(0, 6)}`,
      unit: 'bundle',
      pack: 1,
      base: 25,
    },
    { supplier: 'Großhandel Südrohr', number: `SR-${item.id.slice(0, 6)}`, unit: 'roll', pack: 1, base: 50 },
  ];
  for (const [index, reference] of references.entries()) {
    const { error: referenceError } = await admin.rpc(
      'save_inventory_item_supplier',
      rpcArgs('save_inventory_item_supplier', {
        p_organization_id: input.orgId,
        p_actor_id: input.actorId,
        p_item_id: item.id,
        p_unit: 'meter',
        p_reference_id: null,
        p_supplier_id: null,
        p_supplier_name: reference.supplier,
        p_supplier_article_number: reference.number,
        p_purchase_unit: reference.unit,
        p_pack_quantity: reference.pack,
        p_base_quantity: reference.base,
        p_is_preferred: index === 0,
      }),
    );
    if (referenceError) throw new Error(`Failed to seed supplier reference: ${referenceError.message}`);
  }
  const prices = [
    { kind: 'purchase', amount: 395, quantity: 1, validFrom: '2026-01-01' },
    { kind: 'purchase', amount: 41200, quantity: 100, validFrom: '2026-07-01' },
    { kind: 'sale', amount: 6490, quantity: 10, validFrom: '2026-07-01' },
    { kind: 'purchase', amount: 43800, quantity: 100, validFrom: '2099-01-01' },
  ];
  for (const price of prices) {
    const { error: priceError } = await admin.rpc('add_inventory_item_price', {
      p_organization_id: input.orgId,
      p_actor_id: input.actorId,
      p_item_id: item.id,
      p_unit: 'meter',
      p_kind: price.kind,
      p_amount_cents: price.amount,
      p_price_quantity: price.quantity,
      p_valid_from: price.validFrom,
    });
    if (priceError) throw new Error(`Failed to seed article price: ${priceError.message}`);
  }
  return item.id;
}
