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
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import {
  invoiceLineSourceRefSchema,
  type InvoiceCatalogLine,
  type InvoiceLineSourceRef,
  type OfferCatalogLine,
} from './line-sources';
import { INVOICE_TAX_RATES, type InvoiceTaxRate } from './types';

// A draft line from the catalog: the office picks a Leistung or an article,
// and the server reads its name, unit, tax rate and today's net sale price
// (Berlin) through the readers of E2a (readLeistungPrices) and E1
// (readArticlePrices). The editor copies the answer into a new line, where
// the office can still change every value before the save. An offer Position
// from an article or a Leistung takes the same rule (readOfferArticleLine,
// readOfferLeistungLine), so offers and invoices price an entry alike; only
// the offer's answer adds the entry's cost, for the office's calculation.

type CatalogLineResult = ActionResult<{ line: InvoiceCatalogLine }>;
type OfferCatalogLineResult = ActionResult<{ line: OfferCatalogLine }>;
/** A unit outside the list: an invoice refuses the entry, an offer asks the office for a unit. */
type UnitOutsideList = 'refuse' | 'ask';

/** The longest name and description a line keeps (the invoice_lines checks). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

type SourceFacts = { number: string | null; name: string; description: string; archived: boolean };
type SourceAmount = { amountCents: number; priceQuantity: PriceQuantity };
type SourcePrice = {
  unit: InventoryUnitCode | null;
  salePrice: SourceAmount | null;
  /** An article's purchase price or a Leistung's cost rate on the day. */
  cost: SourceAmount | null;
  taxRateBasisPoints: number;
};

function taxRateOf(basisPoints: number): InvoiceTaxRate | null {
  return INVOICE_TAX_RATES.find((rate) => rate === basisPoints) ?? null;
}

/** The line, or the reason the catalog entry cannot become one today. */
function catalogLine(
  ref: InvoiceLineSourceRef,
  facts: SourceFacts,
  price: SourcePrice,
  unitOutsideList: UnitOutsideList,
): OfferCatalogLineResult {
  if (facts.archived) return { success: false, error: 'source_archived' };
  if (!price.salePrice) return { success: false, error: 'source_unpriced' };
  if (!price.unit && unitOutsideList === 'refuse') return { success: false, error: 'source_unit_unknown' };
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
      cost: price.cost && { amountCents: price.cost.amountCents, priceQuantity: price.cost.priceQuantity },
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
    const price = read.prices.find((entry) => entry.leistungId === ref.id);
    return price ? { ...price, cost: price.costRate } : null;
  }
  const read = await readArticlePrices([ref.id], today);
  if (!read.success) return 'failed';
  const price = read.prices.find((entry) => entry.articleId === ref.id);
  return price ? { ...price, cost: price.purchaseCost } : null;
}

/** A new line from the source on today's Berlin date, for Admin and Büro of its organization. */
async function readCatalogLine(
  ref: InvoiceLineSourceRef,
  unitOutsideList: UnitOutsideList,
  action: string,
): Promise<OfferCatalogLineResult> {
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
      logError(`${action}: catalog read failed`, { code: ref.kind });
      return { success: false, error: 'load_failed' };
    }
    if (!facts || !price) return { success: false, error: 'source_not_found' };
    return catalogLine(ref, facts, price, unitOutsideList);
  } catch (error) {
    logError(`${action}: unexpected error`, error);
    return { success: false, error: 'unexpected_error' };
  }
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
  const read = await readCatalogLine(parsed.data, 'refuse', 'readInvoiceLineSource');
  if (!read.success) return read;
  // An invoice line takes no cost: the answer stays as before offers kept one.
  const { unit, name, description, unitPriceCents, priceQuantity, taxRateBasisPoints, source } = read.line;
  return unit
    ? {
        success: true,
        line: { name, description, unit, unitPriceCents, priceQuantity, taxRateBasisPoints, source },
      }
    : { success: false, error: 'source_unit_unknown' };
}

/**
 * A new offer Position from an article of the caller's organization, by the
 * rule of an invoice line and priced on today's Berlin date, the date a draft
 * offer carries, with the article's purchase cost of that day. Admin and Büro
 * only. Unlike an invoice line, an article whose stored unit is outside the
 * list answers with `unit: null`: the offer editor asks the office for a unit
 * before it saves.
 */
export async function readOfferArticleLine(rawInput: { articleId: string }): Promise<OfferCatalogLineResult> {
  const parsed = z.object({ articleId: uuidSchema }).safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  return readCatalogLine({ kind: 'article', id: parsed.data.articleId }, 'ask', 'readOfferArticleLine');
}

/**
 * A new offer Position from a Leistung of the caller's organization, as
 * readOfferArticleLine reads an article, with the cost rate of the price
 * version that applies today.
 */
export async function readOfferLeistungLine(rawInput: {
  leistungId: string;
}): Promise<OfferCatalogLineResult> {
  const parsed = z.object({ leistungId: uuidSchema }).safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  return readCatalogLine({ kind: 'leistung', id: parsed.data.leistungId }, 'ask', 'readOfferLeistungLine');
}
