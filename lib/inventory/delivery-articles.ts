import 'server-only';

import { logReadErrors } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { ArticleSupplierReference } from './article-price-terms';
import { toNumber } from './types';

// The own articles a delivery names (werk-flow/werkflow-planning#535, KI-0 part 3 gap 3): the
// inventory picker searches name, number, manufacturer and barcode, never the supplier's article
// number, so WerkFlow KI's Lieferschein matching reads through this reader instead.

type InventoryItemSupplierRow = Database['public']['Tables']['inventory_item_suppliers']['Row'];

/** One supplier reference with its pack conversion: `packQuantity` purchase units hold `baseQuantity` base units. */
export function toSupplierReference(reference: InventoryItemSupplierRow): ArticleSupplierReference {
  return {
    id: reference.id,
    supplierId: reference.supplier_id,
    supplierArticleNumber: reference.supplier_article_number,
    purchaseUnit: reference.purchase_unit,
    packQuantity: toNumber(reference.pack_quantity),
    baseQuantity: toNumber(reference.base_quantity),
    isPreferred: reference.is_preferred,
  };
}

/** An active own article a delivery line may name, with every supplier reference and barcode, no price. */
export type DeliveryArticle = {
  itemId: string;
  name: string;
  internalSku: string | null;
  /** The base unit's code. */
  unit: string;
  references: ArticleSupplierReference[];
  barcodes: string[];
};

/**
 * The active own articles whose supplier article number or barcode a delivery
 * names, each with all its supplier references, so a line can be converted
 * through the reference's pack (werk-flow/werkflow-planning#535, KI-0 part 3
 * gap 3). Server-only, for the caller's organization, which the caller
 * resolved; it reads no price. A failed or overflowing read is `failed`.
 */
export async function readDeliveryArticles(
  admin: AdminClient,
  orgId: string,
  named: { articleNumbers: readonly string[]; eans: readonly string[] },
): Promise<DeliveryArticle[] | 'failed'> {
  const [byNumber, byBarcode] = await Promise.all([
    readInBatches([...named.articleNumbers], (batch) =>
      admin
        .from('inventory_item_suppliers')
        .select('item_id')
        .eq('organization_id', orgId)
        .in('supplier_article_number', [...batch])
        .limit(LIST_ROW_CAP),
    ),
    readInBatches([...named.eans], (batch) =>
      admin
        .from('inventory_item_barcodes')
        .select('item_id')
        .eq('organization_id', orgId)
        .in('barcode_value', [...batch])
        .limit(LIST_ROW_CAP),
    ),
  ]);
  if (byNumber.error || byBarcode.error) {
    logReadErrors('readDeliveryArticles: match read failed', byNumber.error, byBarcode.error);
    return 'failed';
  }
  const itemIds = [...new Set([...byNumber.data, ...byBarcode.data].map((row) => row.item_id))];
  if (itemIds.length === 0) return [];
  const [items, references, barcodes] = await Promise.all([
    readInBatches(itemIds, (batch) =>
      admin
        .from('inventory_items')
        .select('id, name, internal_sku, unit')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .in('id', [...batch]),
    ),
    readInBatches(itemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_suppliers')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('created_at')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(itemIds, (batch) =>
      admin
        .from('inventory_item_barcodes')
        .select('item_id, barcode_value')
        .eq('organization_id', orgId)
        .in('item_id', [...batch])
        .limit(LIST_ROW_CAP),
    ),
  ]);
  if (items.error || references.error || barcodes.error) {
    logReadErrors('readDeliveryArticles: article read failed', items.error, references.error, barcodes.error);
    return 'failed';
  }
  return items.data.map((item) => ({
    itemId: item.id,
    name: item.name,
    internalSku: item.internal_sku,
    unit: item.unit,
    references: references.data.filter((row) => row.item_id === item.id).map(toSupplierReference),
    barcodes: barcodes.data.filter((row) => row.item_id === item.id).map((row) => row.barcode_value),
  }));
}
