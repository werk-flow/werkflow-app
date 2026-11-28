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
 * The articles a delivery's numbers and EANs name: complete reads, so a
 * second article with one number is never cut off. A barcode names one
 * article of the organization, so its rows also hold each article's matched barcodes.
 */
async function readNamedRows(
  admin: AdminClient,
  orgId: string,
  named: { articleNumbers: readonly string[]; eans: readonly string[] },
  signal: AbortSignal,
) {
  // postgrest-js does not escape a quote or backslash inside an `in` list, so such a number is looked up alone.
  const listable = named.articleNumbers.filter((number) => !/["\\]/.test(number));
  const alone = named.articleNumbers.filter((number) => /["\\]/.test(number));
  /** One page of the references a number, or a list of numbers, names. */
  const numberRows = (numbers: string | readonly string[]) => (from: number, to: number) => {
    const query = admin.from('inventory_item_suppliers').select('item_id').eq('organization_id', orgId);
    return (
      typeof numbers === 'string'
        ? query.eq('supplier_article_number', numbers)
        : query.in('supplier_article_number', [...numbers])
    )
      .order('id')
      .range(from, to)
      .abortSignal(signal);
  };
  const [byListedNumber, byLoneNumber, byBarcode] = await Promise.all([
    readInBatches(listable, (batch) => readCompleteRows(numberRows(batch), LIST_ROW_CAP)),
    readInBatches(alone, ([number = '']) => readCompleteRows(numberRows(number), LIST_ROW_CAP), 1),
    readInBatches(named.eans, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_item_barcodes')
            .select('item_id, barcode_value')
            .eq('organization_id', orgId)
            .in('barcode_value', [...batch])
            .order('id')
            .range(from, to)
            .abortSignal(signal),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (byListedNumber.error || byLoneNumber.error || byBarcode.error) {
    logReadErrors(
      'readDeliveryArticles: match read failed',
      byListedNumber.error,
      byLoneNumber.error,
      byBarcode.error,
    );
    return 'failed';
  }
  return { byNumber: [...byListedNumber.data, ...byLoneNumber.data], byBarcode: byBarcode.data };
}

/**
 * The active own articles whose supplier article number or barcode a delivery
 * names, each with all its supplier references, so a line can be converted
 * through the reference's pack (werk-flow/werkflow-planning#535, KI-0 part 3
 * gap 3). Server-only, for the caller's organization, which the caller
 * resolved; it reads no price. Every read is complete: a failed or
 * overflowing read is `failed`, never a shorter list.
 */
export async function readDeliveryArticles(
  admin: AdminClient,
  orgId: string,
  named: { articleNumbers: readonly string[]; eans: readonly string[] },
  signal: AbortSignal,
): Promise<DeliveryArticle[] | 'failed'> {
  const rows = await readNamedRows(admin, orgId, named, signal);
  if (rows === 'failed') return 'failed';
  const { byNumber, byBarcode } = rows;
  const itemIds = [...new Set([...byNumber, ...byBarcode].map((row) => row.item_id))];
  if (itemIds.length === 0) return [];
  const [items, references] = await Promise.all([
    readInBatches(itemIds, (batch) =>
      admin
        .from('inventory_items')
        .select('id, name, internal_sku, unit')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .in('id', [...batch])
        .abortSignal(signal),
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
            .range(from, to)
            .abortSignal(signal),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (items.error || references.error) {
    logReadErrors('readDeliveryArticles: article read failed', items.error, references.error);
    return 'failed';
  }
  return items.data.map((item) => ({
    itemId: item.id,
    name: item.name,
    internalSku: item.internal_sku,
    unit: item.unit,
    references: references.data.filter((row) => row.item_id === item.id).map(toSupplierReference),
    barcodes: byBarcode.filter((row) => row.item_id === item.id).map((row) => row.barcode_value),
  }));
}

/** A wholesaler-catalog article whose number a delivery line names, without its price. */
export type DeliveryCatalogArticle = { supplierName: string; name: string; unit: string };

/**
 * The organization's wholesaler-catalog articles whose number is exactly
 * `articleNumber`, one per supplier, without any price. The trigram index of
 * the picker's search narrows the rows before the exact match, so the match
 * is never cut by the picker's name-sorted page. `failed` on a read error.
 */
export async function readDeliveryCatalogArticles(
  admin: AdminClient,
  orgId: string,
  articleNumber: string,
  signal: AbortSignal,
): Promise<DeliveryCatalogArticle[] | 'failed'> {
  const pattern = `%${articleNumber.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const articles = await readCompleteRows(
    (from, to) =>
      admin
        .from('inventory_supplier_catalog_articles')
        .select('supplier_id, name, unit')
        .eq('organization_id', orgId)
        .like('search_text', pattern)
        .eq('article_number', articleNumber)
        .order('id')
        .range(from, to)
        .abortSignal(signal),
    LIST_ROW_CAP,
  );
  if (articles.error) {
    logReadErrors('readDeliveryCatalogArticles: catalog read failed', articles.error);
    return 'failed';
  }
  const supplierIds = [...new Set(articles.data.map((row) => row.supplier_id))];
  if (supplierIds.length === 0) return [];
  const suppliers = await readInBatches(supplierIds, (batch) =>
    admin
      .from('inventory_suppliers')
      .select('id, name')
      .eq('organization_id', orgId)
      .in('id', [...batch])
      .abortSignal(signal),
  );
  if (suppliers.error) {
    logReadErrors('readDeliveryCatalogArticles: supplier read failed', suppliers.error);
    return 'failed';
  }
  return articles.data.flatMap((row) => {
    const supplier = suppliers.data.find((entry) => entry.id === row.supplier_id);
    return supplier ? [{ supplierName: supplier.name, name: row.name, unit: row.unit }] : [];
  });
}
