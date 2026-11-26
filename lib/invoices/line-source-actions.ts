'use server';

import type { ActionResult } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { readArticlePrices } from '@/lib/inventory/article-prices';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { readLeistungPrices } from '@/lib/price-catalog/leistung-prices';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  invoiceLineSourceRefSchema,
  type InvoiceCatalogLine,
  type InvoiceLineSourceRef,
} from './line-sources';
import { INVOICE_TAX_RATES, type InvoiceTaxRate } from './types';

// A draft line from the catalog: the office picks a Leistung or an article,
// and the server reads its name, unit, tax rate and today's net sale price
// (Berlin) through the readers of E2a (readLeistungPrices) and E1
// (readArticlePrices). The editor copies the answer into a new line, where
// the office can still change every value before the save.

type CatalogLineResult = ActionResult<{ line: InvoiceCatalogLine }>;

/** The longest name and description a line keeps (the invoice_lines checks). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

type SourceFacts = { number: string | null; name: string; description: string; archived: boolean };
type SourcePrice = {
  unit: InventoryUnitCode | null;
  salePrice: { amountCents: number; priceQuantity: PriceQuantity } | null;
  taxRateBasisPoints: number;
};

function taxRateOf(basisPoints: number): InvoiceTaxRate | null {
  return INVOICE_TAX_RATES.find((rate) => rate === basisPoints) ?? null;
}

/** The line, or the reason the catalog entry cannot become one today. */
function catalogLine(ref: InvoiceLineSourceRef, facts: SourceFacts, price: SourcePrice): CatalogLineResult {
  if (facts.archived) return { success: false, error: 'source_archived' };
  if (!price.salePrice) return { success: false, error: 'source_unpriced' };
  if (!price.unit) return { success: false, error: 'source_unit_unknown' };
  const taxRateBasisPoints = taxRateOf(price.taxRateBasisPoints);
  if (taxRateBasisPoints === null) return { success: false, error: 'source_tax_rate_unsupported' };
  return {
    success: true,
    line: {
      name: facts.name.trim().slice(0, NAME_MAX),
      description: facts.description.trim().slice(0, DESCRIPTION_MAX),
      unit: price.unit,
      unitPriceCents: price.salePrice.amountCents,
      priceQuantity: price.salePrice.priceQuantity,
      taxRateBasisPoints,
      source: { ...ref, number: facts.number, name: facts.name, archived: facts.archived },
    },
  };
}

async function leistungFacts(organizationId: string, id: string): Promise<SourceFacts | null | 'failed'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('leistungen')
    .select('leistung_number, name, description, archived_at')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) return 'failed';
  return data
    ? {
        number: data.leistung_number,
        name: data.name,
        description: data.description,
        archived: data.archived_at !== null,
      }
    : null;
}

async function articleFacts(organizationId: string, id: string): Promise<SourceFacts | null | 'failed'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('inventory_items')
    .select('internal_sku, name, description, is_active')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) return 'failed';
  return data
    ? {
        number: data.internal_sku,
        name: data.name,
        description: data.description ?? '',
        archived: !data.is_active,
      }
    : null;
}

/** Today's price of the source, through its domain's reader; null when the reader left it out. */
async function sourcePrice(ref: InvoiceLineSourceRef, today: string): Promise<SourcePrice | null | 'failed'> {
  if (ref.kind === 'leistung') {
    const read = await readLeistungPrices([ref.id], today);
    if (!read.success) return 'failed';
    return read.prices.find((price) => price.leistungId === ref.id) ?? null;
  }
  const read = await readArticlePrices([ref.id], today);
  if (!read.success) return 'failed';
  return read.prices.find((price) => price.articleId === ref.id) ?? null;
}

/**
 * A new draft line from a Leistung or an article of the caller's
 * organization, priced on today's Berlin date. Admin and Büro only. Refuses
 * an archived entry, one without a sale price today, one with a unit outside
 * the list and one with a VAT rate a line does not offer.
 */
export async function readInvoiceLineSource(rawInput: InvoiceLineSourceRef): Promise<CatalogLineResult> {
  const parsed = invoiceLineSourceRefSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const ref = parsed.data;
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId } = caller.context;
    const [facts, price] = await Promise.all([
      ref.kind === 'leistung' ? leistungFacts(orgId, ref.id) : articleFacts(orgId, ref.id),
      sourcePrice(ref, getBusinessTodayIso()),
    ]);
    if (facts === 'failed' || price === 'failed') {
      logError('readInvoiceLineSource: catalog read failed', { code: ref.kind });
      return { success: false, error: 'load_failed' };
    }
    if (!facts || !price) return { success: false, error: 'source_not_found' };
    return catalogLine(ref, facts, price);
  } catch (error) {
    logError('readInvoiceLineSource: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
