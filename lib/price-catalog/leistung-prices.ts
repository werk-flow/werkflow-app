import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { type InventoryUnitCode, isInventoryUnitCode } from '@/lib/inventory/units';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The one reader of Leistung prices for offers and orders, shaped like
// `readArticlePrices` (lib/inventory/article-prices.ts) so a caller prices an
// article line and a Leistung line alike. Server only, for Admin and Büro: a
// field worker never reads a cost rate or a sale price.

/** An amount in cents for `priceQuantity` units of the Leistung. */
type LeistungPriceAmount = { amountCents: number; priceQuantity: PriceQuantity };

export type LeistungPrice = {
  leistungId: string;
  /** The Leistung's unit, or `null` for a stored code outside the list („Einheit prüfen“). */
  unit: InventoryUnitCode | null;
  /** The internal cost rate; `null` when the version keeps none or no version applies yet. */
  costRate: LeistungPriceAmount | null;
  /** Net sale price; `null` while no version applies on that day. */
  salePrice: LeistungPriceAmount | null;
  /** 1900 is 19 %. */
  taxRateBasisPoints: number;
  /** The first day of the version that applies, or `null` while none does. */
  priceDate: string | null;
  /** The version that applies, for a line's source reference; `null` while none does. */
  priceVersionId: string | null;
  source: 'leistung';
};

const readLeistungPricesSchema = z.object({
  leistungIds: z.array(uuidSchema),
  onDate: z.iso.date(),
});

const priceRowSchema = z.object({
  leistung_id: uuidSchema,
  unit: z.string(),
  tax_rate_basis_points: z.number().int(),
  price_version_id: uuidSchema.nullable(),
  valid_from: z.iso.date().nullable(),
  sale_price_cents: z.number().int().nullable(),
  cost_rate_cents: z.number().int().nullable(),
});
type PriceRow = z.infer<typeof priceRowSchema>;

function toLeistungPrice(row: PriceRow): LeistungPrice {
  return {
    leistungId: row.leistung_id,
    unit: isInventoryUnitCode(row.unit) ? row.unit : null,
    costRate: row.cost_rate_cents === null ? null : { amountCents: row.cost_rate_cents, priceQuantity: 1 },
    salePrice: row.sale_price_cents === null ? null : { amountCents: row.sale_price_cents, priceQuantity: 1 },
    taxRateBasisPoints: row.tax_rate_basis_points,
    priceDate: row.valid_from,
    priceVersionId: row.price_version_id,
    source: 'leistung',
  };
}

/**
 * The prices of the caller's organization's Leistungen on `onDate` (a Berlin
 * date, `YYYY-MM-DD`): the version with the latest first day up to that day.
 * An id of another organization or of no Leistung is left out of the answer;
 * an archived Leistung answers.
 */
export async function readLeistungPrices(
  leistungIds: readonly string[],
  onDate: string,
): Promise<ActionResult<{ prices: LeistungPrice[] }>> {
  const parsed = readLeistungPricesSchema.safeParse({ leistungIds, onDate });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  if (parsed.data.leistungIds.length === 0) return { success: true, prices: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await readInBatches(parsed.data.leistungIds, (batch) =>
    admin.rpc('leistung_prices_on_day', {
      p_organization_id: caller.context.orgId,
      p_leistung_ids: [...batch],
      p_on_date: parsed.data.onDate,
    }),
  );
  const rows = z.array(priceRowSchema).safeParse(data);
  if (error || !rows.success) {
    logError('readLeistungPrices: leistung_prices_on_day failed', error ?? rows.error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, prices: rows.data.map(toLeistungPrice) };
}
