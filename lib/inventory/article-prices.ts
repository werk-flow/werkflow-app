import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { ARTICLE_PRICE_ORIGINS, PRICE_QUANTITIES, type ArticlePriceAmount } from './article-price-terms';
import { type InventoryUnitCode, isInventoryUnitCode } from './units';

// The one reader of article prices for offers, orders and the billable review
// (the E1 ↔ E2a seam, werk-flow/werkflow-planning#15). Server only, for Admin
// and Büro: a field worker never reads a purchase or sale price. The return
// type is the contract.
//
// The source is the article's dated prices: the database function
// `read_inventory_item_prices_on_day` owns which price applies on a day, per kind
// (migration 20261203150000). An archived article answers too, because offer
// and order lines keep referencing it.

export type ArticlePrice = {
  articleId: string;
  /** The base unit, or `null` for a stored unit outside the list („Einheit prüfen“). */
  unit: InventoryUnitCode | null;
  /** Net purchase cost on that day, organization-wide; `null` while none applies. */
  purchaseCost: ArticlePriceAmount | null;
  /** Net list sale price on that day; `null` while none applies. */
  salePrice: ArticlePriceAmount | null;
  /** 1900 is 19 %. */
  taxRateBasisPoints: number;
  /** The Berlin day from which both prices apply (the later first day); the asked day while none applies. */
  priceDate: string;
  /** What was priced: an article, beside `'leistung'` of the Leistung reader. */
  source: 'article';
};

const readArticlePricesSchema = z.object({
  articleIds: z.array(uuidSchema),
  onDate: z.iso.date(),
});

const priceRowSchema = z.object({
  item_id: uuidSchema,
  unit: z.string(),
  tax_rate_basis_points: z.number().int(),
  purchase_amount_cents: z.number().int().nullable(),
  purchase_price_quantity: z.literal(PRICE_QUANTITIES).nullable(),
  purchase_valid_from: z.iso.date().nullable(),
  purchase_source: z.enum(ARTICLE_PRICE_ORIGINS).nullable(),
  sale_amount_cents: z.number().int().nullable(),
  sale_price_quantity: z.literal(PRICE_QUANTITIES).nullable(),
  sale_valid_from: z.iso.date().nullable(),
  sale_source: z.enum(ARTICLE_PRICE_ORIGINS).nullable(),
});
type PriceRow = z.infer<typeof priceRowSchema>;

function amountOf(
  amountCents: number | null,
  priceQuantity: ArticlePriceAmount['priceQuantity'] | null,
  validFrom: string | null,
  origin: ArticlePriceAmount['origin'] | null,
): ArticlePriceAmount | null {
  if (amountCents === null || priceQuantity === null || validFrom === null || origin === null) return null;
  return { amountCents, priceQuantity, validFrom, origin };
}

function toArticlePrice(row: PriceRow, onDate: string): ArticlePrice {
  const purchaseCost = amountOf(
    row.purchase_amount_cents,
    row.purchase_price_quantity,
    row.purchase_valid_from,
    row.purchase_source,
  );
  const salePrice = amountOf(
    row.sale_amount_cents,
    row.sale_price_quantity,
    row.sale_valid_from,
    row.sale_source,
  );
  const firstDays = [purchaseCost?.validFrom, salePrice?.validFrom].flatMap((day) => (day ? [day] : []));
  return {
    articleId: row.item_id,
    unit: isInventoryUnitCode(row.unit) ? row.unit : null,
    purchaseCost,
    salePrice,
    taxRateBasisPoints: row.tax_rate_basis_points,
    priceDate: firstDays.sort().at(-1) ?? onDate,
    source: 'article',
  };
}

/**
 * The prices of the caller's organization's articles on `onDate` (a Berlin
 * date, `YYYY-MM-DD`). An id of another organization or of no article is left
 * out of the answer.
 */
export async function readArticlePrices(
  articleIds: readonly string[],
  onDate: string,
): Promise<ActionResult<{ prices: ArticlePrice[] }>> {
  const parsed = readArticlePricesSchema.safeParse({ articleIds, onDate });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  if (parsed.data.articleIds.length === 0) return { success: true, prices: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await readInBatches(parsed.data.articleIds, (batch) =>
    admin.rpc('read_inventory_item_prices_on_day', {
      p_organization_id: auth.context.orgId,
      p_item_ids: [...batch],
      p_on_date: parsed.data.onDate,
    }),
  );
  const rows = z.array(priceRowSchema).safeParse(data);
  if (error || !rows.success) {
    logError(
      'readArticlePrices: read_inventory_item_prices_on_day failed',
      error ?? { code: 'malformed_result' },
    );
    return { success: false, error: 'load_failed' };
  }
  return { success: true, prices: rows.data.map((row) => toArticlePrice(row, parsed.data.onDate)) };
}
