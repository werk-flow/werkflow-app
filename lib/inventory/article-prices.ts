import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { PriceQuantity } from './line-amount';
import { type InventoryUnitCode, isInventoryUnitCode } from './units';

// The one reader of article prices for offers, orders and the billable review
// (the E1 ↔ E2a seam, werk-flow/werkflow-planning#15). Server only, for Admin
// and Büro: a field worker never reads a purchase or sale price. The return
// type is the contract; a later source (supplier references with dated
// prices) changes only how the answer is found.
//
// Today's source is the article row: one current purchase and sale price per
// base unit, dated by the article's last save. An archived article answers
// too, because offer and order lines keep referencing it.

/** An amount in cents for `priceQuantity` base units of the article. */
type ArticlePriceAmount = { amountCents: number; priceQuantity: PriceQuantity };

type ArticlePriceSource = 'article';

export type ArticlePrice = {
  articleId: string;
  /** The base unit, or `null` for a stored unit outside the list („Einheit prüfen“). */
  unit: InventoryUnitCode | null;
  /** Net purchase cost, organization-wide; `null` when the article has none. */
  purchaseCost: ArticlePriceAmount | null;
  /** Net list sale price; `null` when the article has none. */
  salePrice: ArticlePriceAmount | null;
  /** 1900 is 19 %. */
  taxRateBasisPoints: number;
  /** The Berlin date from which these prices apply. */
  priceDate: string;
  source: ArticlePriceSource;
};

const readArticlePricesSchema = z.object({
  articleIds: z.array(uuidSchema),
  onDate: z.iso.date(),
});

type ArticlePriceRow = {
  id: string;
  unit: string;
  purchase_price_cents: number | null;
  sale_price_cents: number | null;
  tax_rate_basis_points: number;
  updated_at: string;
};

function perBaseUnit(amountCents: number | null): ArticlePriceAmount | null {
  return amountCents === null ? null : { amountCents, priceQuantity: 1 };
}

function toArticlePrice(row: ArticlePriceRow): ArticlePrice {
  return {
    articleId: row.id,
    unit: isInventoryUnitCode(row.unit) ? row.unit : null,
    purchaseCost: perBaseUnit(row.purchase_price_cents),
    salePrice: perBaseUnit(row.sale_price_cents),
    taxRateBasisPoints: row.tax_rate_basis_points,
    priceDate: formatBerlinLocalDate(row.updated_at),
    source: 'article',
  };
}

/**
 * The prices of the caller's organization's articles on `onDate` (a Berlin
 * date, `YYYY-MM-DD`). An id of another organization or of no article is left
 * out of the answer. Today's source keeps only the current price, so every
 * date answers it.
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
    admin
      .from('inventory_items')
      .select('id, unit, purchase_price_cents, sale_price_cents, tax_rate_basis_points, updated_at')
      .eq('organization_id', auth.context.orgId)
      .in('id', batch)
      .order('id'),
  );
  if (error) {
    logError('readArticlePrices: inventory_items read failed', { code: error.code ?? 'unknown' });
    return { success: false, error: 'load_failed' };
  }
  return { success: true, prices: data.map(toArticlePrice) };
}
